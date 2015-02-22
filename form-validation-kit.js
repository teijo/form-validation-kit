var State = {
  OK: 1,
  INVALID: 0,
  PENDING: -1,
  QUEUED: -2
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
            state: isValid ? State.OK : State.INVALID,
            errorMessage: errorMessage || ""
          });
        });
      });
    }));
  });

  var requestQueued = input.map({
    state: State.QUEUED,
    errorMessageList: []
  });
  var requestSent = throttledInput.map({
    state: State.PENDING,
    errorMessageList: []
  });
  var response = validationStream.map(function(responseList) {
    return responseList.reduce(function(agg, response) {
      if (response.state === State.INVALID) {
        agg.state = State.INVALID;
        agg.errorMessageList = agg.errorMessageList.concat(response.errorMessage);
      }
      return agg;
    }, {state: State.OK, errorMessageList: []});
  });

  var state = Bacon.mergeAll(
      requestQueued,
      requestSent,
      response
  ).skipDuplicates();

  function stateResolved(response) {
    return (response.state === State.INVALID || response.state === State.OK);
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
      var PRECEDENCE = [State.QUEUED, State.PENDING, State.INVALID, State.OK];
      return validators.reduce(function(agg, state) {
        return (PRECEDENCE.indexOf(state) < PRECEDENCE.indexOf(agg)) ? state : agg;
      })
    }).map(function(combinedState) {
      return {state: combinedState, errorMessageList: []};
    }).skipDuplicates().onValue(stateCallback);
  }

  addValidatorStateStream(Bacon.constant(State.OK));

  return {
    validator: function() {
      var validator = Validation.apply(this, arguments);
      addValidatorStateStream(validator.state);
      return {evaluate: validator.evaluate};
    }
  }
}

