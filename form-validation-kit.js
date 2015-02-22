var State = {
  // Input received but validator invocation is waiting for throttle cooldown
  WAITING: -2,
  // Validator invoked with latest value and waiting for response
  VALIDATING: -1,
  // Validator has evaluated input as invalid
  INVALID: 0,
  // Validator has evaluated input as valid
  VALID: 1
};

function Validation(/*...validators*/) {
  var validatorList = Array.prototype.slice.call(arguments);
  var input = new Bacon.Bus();
  var throttledInput = input.throttle(100);

  var validationStream = throttledInput.flatMapLatest(function(value) {
    return Bacon.combineAsArray(validatorList.map(function(validator) {
      return Bacon.fromCallback(function(done) {
        validator(value, function(isValid, errorMessage) {
          done({
            state: isValid ? State.VALID : State.INVALID,
            errorMessage: errorMessage || ""
          });
        });
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
      if (response.state === State.INVALID) {
        agg.state = State.INVALID;
        agg.errorMessageList = agg.errorMessageList.concat(response.errorMessage);
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
      state.subscribe(function(event) {
        var response = event.value();
        cb(response);
        return stateResolved(response) ? Bacon.noMore : Bacon.more;
      });
      input.push(value);
    }
  }
}

function Form(stateCallback) {
  var stateStreams = [];

  function addValidatorStateStream(stateStream) {
    stateStreams.push(stateStream);
    Bacon.combineAsArray(stateStreams).map(function(validators) {
      var PRECEDENCE = [State.WAITING, State.VALIDATING, State.INVALID, State.VALID];
      return validators.reduce(function(agg, state) {
        return (PRECEDENCE.indexOf(state) < PRECEDENCE.indexOf(agg)) ? state : agg;
      })
    }).map(function(combinedState) {
      return {state: combinedState, errorMessageList: []};
    }).skipDuplicates().onValue(stateCallback);
  }

  addValidatorStateStream(Bacon.constant(State.VALID));

  return {
    validator: function() {
      var validator = Validation.apply(this, arguments);
      addValidatorStateStream(validator.state);
      return {evaluate: validator.evaluate};
    }
  }
}

