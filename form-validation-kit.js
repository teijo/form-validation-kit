try {
  Bacon = require('baconjs');
} catch(e) {}

Validation = (function() {
  var State = {
    // Error occuring during validation, e.g. timeout
    ERROR: 'error',
    // Input received but validator invocation is waiting for throttle cooldown
    QUEUED: 'queued',
    // Validator invoked with latest value and waiting for response
    VALIDATING: 'validating',
    // Validator has evaluated input as invalid
    INVALID: 'invalid',
    // Validator has evaluated input as valid
    VALID: 'valid'
  };

  function Validation(validatorList, options) {
    var input = new Bacon.Bus();
    var initialInput = new Bacon.Bus();
    var throttledInput = input.debounce(options.throttle || 100);

    var validationStream = throttledInput.merge(initialInput).flatMapLatest(function(value) {
      return Bacon.combineAsArray(validatorList.map(function(validator) {
        return Bacon.fromCallback(function(done) {
          validator(
              value,
              // Validation done
              function(isValid, errorMessage) {
                done({
                  state: isValid ? State.VALID : State.INVALID,
                  errorMessage: errorMessage || ""
                });
              },
              // Validation error
              function(errorMessage) {
                done({
                  state: State.ERROR,
                  errorMessage: errorMessage
                })
              }
          );
        });
      }));
    });

    var requestQueued = input.map({
      state: State.QUEUED,
      errorMessages: []
    });
    var requestSent = throttledInput.map({
      state: State.VALIDATING,
      errorMessages: []
    });
    var response = validationStream.map(function(responseList) {
      return responseList.reduce(function(agg, response) {
        switch (response.state) {
          case State.INVALID:
          case State.ERROR:
            agg.state = response.state;
            agg.errorMessages = agg.errorMessages.concat(response.errorMessage);
            break;
        }
        return agg;
      }, {state: State.VALID, errorMessages: []});
    });

    var state = Bacon.mergeAll(
        requestQueued,
        requestSent,
        response
    ).skipDuplicates();

    function stateResolved(response) {
      return (response.state === State.ERROR || response.state === State.INVALID || response.state === State.VALID);
    }

    return {
      state: state.map('.state'),
      init: function(value) {
        initialInput.push(value);
      },
      evaluate: function(value, cb) {
        if (cb !== undefined && typeof(cb) !== 'function') {
          throw new Error('Second argument needs to be a function(state) {}')
        }
        state.subscribe(function(event) {
          var response = event.value();
          cb(response);
          return stateResolved(response) ? Bacon.noMore : Bacon.more;
        });
        input.push(value);
      }
    }
  }

  function Create(stateCallback) {
    var validatorCount = 0;
    var stateStreams = {};
    var unplug = function() {};
    var combinedStreams = new Bacon.Bus();

    combinedStreams.map(function(validators) {
      var PRECEDENCE = [State.ERROR, State.QUEUED, State.VALIDATING, State.INVALID, State.VALID];
      return Object.keys(validators).map(function(k) {
        return validators[k];
      }).reduce(function(agg, state) {
        return (PRECEDENCE.indexOf(state) < PRECEDENCE.indexOf(agg)) ? state : agg;
      }, State.VALID)
    }).map(function(combinedState) {
      return {state: combinedState, errorMessages: []};
    }).skipDuplicates(function(prev, current) {
      return prev.errorMessages.reduce(function(agg, e, i) {
        return agg && (e === current.errorMessages[i]);
      }, (prev.state === current.state));
    }).onValue(stateCallback);

    function updateStream() {
      unplug();
      unplug = combinedStreams.plug(Bacon.combineTemplate(stateStreams));
    }

    function register(stateStream) {
      validatorCount++;
      stateStreams[validatorCount] = stateStream.toProperty();
      updateStream();
      return validatorCount;
    }

    function unregister(id) {
      delete stateStreams[id];
      updateStream();
    }

    return {
      register: function(/*validator, validator, ..., options*/) {
        var validatorList = Array.prototype.slice.call(arguments);
        if (validatorList.length === 0) {
          throw new Error('At least one validator must be given');
        }

        var options = {};
        var last = validatorList[validatorList.length - 1];
        if (typeof(last) === 'object') {
          options = last;
          validatorList.pop();
        }
        var validator = Validation(validatorList, options);
        var id = register(validator.state);
        if (options.init) {
          validator.init(options.init);
        }

        var registered = true;
        return {
          evaluate: function(value, cb) {
            if (!registered) {
              throw new Error('Cannot evaluate. unregister() has been called for this validator earlier.')
            }
            validator.evaluate.apply(this, arguments);
          },
          unregister: function() {
            if (!registered) {
              throw new Error("Cannot unregister. unregister() can be called only once for validator.");
            }
            registered = false;
            unregister(id);
          }
        };
      }
    }
  }
  return {
    Error: State.ERROR,
    Waiting: State.QUEUED,
    Validating: State.VALIDATING,
    Invalid: State.INVALID,
    Valid: State.VALID,
    Create: Create
  }
})();

try {
  module.exports = Validation;
} catch(e) {}
