try {
  Bacon = require('baconjs');
} catch(e) {}

Validation = (function() {
  var State = {
    // Error occuring during validation, e.g. timeout
    ERROR: 'error',
    // Input received but validator invocation is waiting for throttle cooldown
    WAITING: 'waiting',
    // Validator invoked with latest value and waiting for response
    VALIDATING: 'validating',
    // Validator has evaluated input as invalid
    INVALID: 'invalid',
    // Validator has evaluated input as valid
    VALID: 'valid'
  };

  function Validation(validatorList, options) {
    var input = new Bacon.Bus();
    var throttledInput = input.throttle(options.throttle);

    var validationStream = throttledInput.flatMapLatest(function(value) {
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
      state: State.WAITING,
      errorMessageList: []
    });
    var requestSent = throttledInput.map({
      state: State.VALIDATING,
      errorMessageList: []
    });
    var response = validationStream.map(function(responseList) {
      return responseList.reduce(function(agg, response) {
        switch (response.state) {
          case State.INVALID:
          case State.ERROR:
            agg.state = response.state;
            agg.errorMessageList = agg.errorMessageList.concat(response.errorMessage);
            break;
        }
        return agg;
      }, {state: State.VALID, errorMessageList: []});
    });

    var state = Bacon.mergeAll(
        requestQueued,
        requestSent,
        response
    ).skipDuplicates();

    function stateResolved(response) {
      return (response.state === State.INVALID || response.state === State.VALID);
    }

    return {
      state: state.map('.state'),
      evaluate: function(value, cb) {
        if (typeof(cb) !== 'function') {
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
    var stateStreams = [];

    function addValidatorStateStream(stateStream) {
      stateStreams.push(stateStream);
      Bacon.combineAsArray(stateStreams).map(function(validators) {
        var PRECEDENCE = [State.ERROR, State.WAITING, State.VALIDATING, State.INVALID, State.VALID];
        return validators.reduce(function(agg, state) {
          return (PRECEDENCE.indexOf(state) < PRECEDENCE.indexOf(agg)) ? state : agg;
        })
      }).map(function(combinedState) {
        return {state: combinedState, errorMessageList: []};
      }).skipDuplicates().onValue(stateCallback);
    }

    addValidatorStateStream(Bacon.constant(State.VALID));

    return {
      validator: function(/*validator, validator, ..., options*/) {
        var validatorList = Array.prototype.slice.call(arguments);
        if (validatorList.length === 0) {
          throw new Error('At least one validator must be given');
        }

        var options = {throttle: 100};
        var last = validatorList[validatorList.length - 1];
        if (typeof(last) === 'object') {
          options = last;
          validatorList.pop();
        }
        var validator = Validation(validatorList, options);
        addValidatorStateStream(validator.state);
        return {evaluate: validator.evaluate};
      }
    }
  }
  return {
    Error: State.ERROR,
    Waiting: State.WAITING,
    Validating: State.VALIDATING,
    Invalid: State.INVALID,
    Valid: State.VALID,
    Create: Create
  }
})();

try {
  module.exports = Validation;
} catch(e) {}
