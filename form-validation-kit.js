try {
  Bacon = require('baconjs');
} catch(e) {}

Validation = (function() {
  var DEFAULT_THROTTLE = 0;

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
    validatorList.forEach(function(v) {
      var arity = v.length;
      if (arity < 1 || arity > 3) {
        throw new Error("Synchronous validator type is Function(string), asynchronous type is Function(string, done(bool, string), error(string)), got function taking " + arity + " arguments.");
      }
    });
    var eventId = 0;
    var input = new Bacon.Bus();
    var initialInput = new Bacon.Bus();
    var throttling = typeof(options.throttle) === 'number' ? options.throttle : DEFAULT_THROTTLE;
    var throttledInput = input.debounce(throttling);

    var hasAsyncValidators = validatorList.reduce(function(acc, v) { return acc || v.length > 1; }, false);

    var validationStream = throttledInput.merge(initialInput).flatMapLatest(function(event) {
      return Bacon.combineAsArray(validatorList.map(function(validator) {
        return Bacon.fromCallback(function(done) {
          if (validator.length == 1) {
            var state = null;
            var response = null;
            try {
              var result = validator(event.value);
              switch (typeof(result)) {
                case "undefined":
                case "boolean":
                  state = (result === false) ? State.INVALID : State.VALID /*undefined or true*/;
                  break;
                case "string":
                  state = State.INVALID;
                  response = result;
                  break;
                default:
                  throw new Error("Synchronous validator API: Return string for INVALID, nothing for VALID, and throw exception for ERROR state.");
              }
            } catch (e) {
              state = State.ERROR;
              response = e.message;
            }
            done({
              id: event.id,
              state: state,
              response: response
            });
          } else {
            validator(
                event.value,
                // Validation done
                function(isValid, response) {
                  done({
                    id: event.id,
                    state: isValid ? State.VALID : State.INVALID,
                    response: response
                  });
                },
                // Validation error
                function(response) {
                  done({
                    id: event.id,
                    state: State.ERROR,
                    response: response
                  })
                }
            );
          }
        });
      }));
    });

    var streams = [];

    var requestQueued = input.map(function(i) {
      return {
        id: i.id,
        state: State.QUEUED,
        response: []
      }
    });
    if (throttling > 0) {
      streams.push(requestQueued);
    }

    var requestSent = throttledInput.map(function(i) {
      return {
        id: i.id,
        state: State.VALIDATING,
        response: []
      }
    });
    if (hasAsyncValidators) {
      streams.push(requestSent);
    }

    var response = validationStream.map(function(responseList) {
      return responseList.reduce(function(agg, response) {
        agg.id = response.id;
        switch (response.state) {
          case State.VALID:
          case State.INVALID:
          case State.ERROR:
            agg.state = response.state;
            agg.response = agg.response.concat(response.response);
            break;
        }
        return agg;
      }, {state: State.VALID, response: []});
    });
    streams.push(response);

    var state = Bacon.mergeAll.apply(this, streams).skipDuplicates(function(prev, current) {
      return prev.state == current.state;
    });

    function nextEventId() {
      eventId++;
      return eventId;
    }

    // How to discard events from earlier evaluations without global counter?
    //
    // New evaluation always unsubscribes old evaluator callback and registers
    // its latest callback. Unsubscribe does not "flush" old event chain
    // (queue->validating->resolved) and so previous resolved state can appear
    // after current queue state without filtering.
    var latestState = state.filter(function(event) {
      return event.id === eventId;
    });

    return {
      state: latestState.map('.state'),
      init: function(value) {
        initialInput.push({id: nextEventId(), value: value});
      },
      evaluate: function(value, cb) {
        if (cb !== undefined && typeof(cb) !== 'function') {
          throw new Error('Second argument needs to be a function(state) {}')
        }

        var latestId = nextEventId();

        var unsubscribe = latestState.onValue(cb);
        input.push({id: latestId, value: value});
        return unsubscribe;
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
      return {state: combinedState};
    }).skipDuplicates(function(prev, current) {
      return (prev.state === current.state);
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

        var ongoingSubscription = function() {};
        var registered = true;
        return {
          evaluate: function(value, cb) {
            if (!registered) {
              throw new Error('Cannot evaluate. unregister() has been called for this validator earlier.')
            }
            // Remove subscription from ongoing evaluation to prevent
            // duplicate callbacks e.g. when throttling
            ongoingSubscription();
            ongoingSubscription = validator.evaluate.apply(this, arguments);
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
    Queued: State.QUEUED,
    Validating: State.VALIDATING,
    Invalid: State.INVALID,
    Valid: State.VALID,
    Create: Create
  }
})();

try {
  module.exports = Validation;
} catch(e) {}
