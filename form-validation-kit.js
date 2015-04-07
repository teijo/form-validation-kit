try {
  Bacon = require('baconjs');
} catch(e) {}

Validation = (function() {
  var DEFAULT_THROTTLE = 0;

  var Result = {
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
  var PRECEDENCE = [Result.ERROR, Result.QUEUED, Result.VALIDATING, Result.INVALID, Result.VALID];

  function isValidator(v) {
    return (v instanceof Validator);
  }

  function not(fn) {
    return function(val) {
      return !fn(val)
    }
  }

  function getState(validator) {
    return validator.__state;
  }

  function validatorResponse(event) {
    return function(validator) {
      return Bacon.fromCallback(function(done) {
        if (validator.length == 1) { // Synchronous validator
          var state = null;
          var response = null;
          try {
            var result = validator(event.value);
            switch (typeof(result)) {
              case "undefined":
              case "boolean":
                state = (result === false) ? Result.INVALID : Result.VALID /*undefined or true*/;
                break;
              case "string":
                state = Result.INVALID;
                response = result;
                break;
              default:
                throw new Error("Synchronous validator API: Return string for INVALID, nothing for VALID, and throw exception for ERROR state.");
            }
          } catch (e) {
            state = Result.ERROR;
            response = e.message;
          }
          done({
            state: state,
            response: response
          });
        } else { // Asynchronous validator
          validator(
              event.value,
              // Validation done
              function(isValid, response) {
                done({
                  state: isValid ? Result.VALID : Result.INVALID,
                  response: response
                });
              },
              // Validation error
              function(response) {
                done({
                  state: Result.ERROR,
                  response: response
                })
              }
          );
        }
      }).toProperty();
    }
  }

  function Validator(stateCb, dependencies, options) {
    var validators = dependencies.filter(not(isValidator));
    validators.forEach(function(v) {
      var arity = v.length;
      if (arity < 1 || arity > 3) {
        throw new Error("Synchronous validator type is Function(string), asynchronous type is Function(string, done(bool, string), error(string)), got function taking " + arity + " arguments.");
      }
    });

    var input = new Bacon.Bus();
    var initialInput = new Bacon.Bus();
    var throttling = typeof(options.throttle) === 'number' ? options.throttle : DEFAULT_THROTTLE;
    var throttledInput = input.debounce(throttling);

    var hasAsyncValidators = validators.reduce(function(acc, v) { return acc || v.length > 1; }, false);
    var validationStream = validators.length == 0 ? Bacon.combineAsArray(dependencies.map(getState)) : throttledInput.merge(initialInput).flatMapLatest(function(event) {
      return Bacon.combineAsArray(dependencies.map(function(d) {
        return isValidator(d) ? getState(d) : validatorResponse(event)(d);
      }))
    });

    var streams = [];

    if (throttling > 0) {
      streams.push(input.map({
        state: Result.QUEUED,
        response: []
      }));
    }

    if (hasAsyncValidators) {
      streams.push(throttledInput.map({
        state: Result.VALIDATING,
        response: []
      }));
    }

    streams.push(validationStream.map(function(responseList) {
      return responseList.reduce(function(agg, response) {
        switch (response.state) {
          case Result.VALID:
          case Result.INVALID:
          case Result.ERROR:
            agg.response = agg.response.concat(response.response);
            break;
        }
        agg.state = (PRECEDENCE.indexOf(response.state) < PRECEDENCE.indexOf(agg.state)) ? response.state : agg.state;
        return agg;
      }, {state: Result.VALID, response: []});
    }));

    var state = Bacon.mergeAll.apply(this, streams).skipDuplicates(function(prev, current) {
      return prev.state == current.state;
    }).toProperty();

    state.onValue(function(state) { stateCb(state.state, state.response) });

    this.evaluate = function(value) {
      input.push({value: value});
    };
    var initialized = false;
    this.using = function(value) {
      if (initialized) {
        throw new Error('Can initialize only once');
      }
      initialInput.push({value: value});
      initialized = true;
      return this;
    }.bind(this);
    this.__state = state; // Used by children
  }

  return {
    create: function(stateCb /* ...validators, options */) {
      if (arguments.length < 2) {
        throw new Error("register() requires a callback and at least one validator as argument");
      }
      if (typeof(stateCb) !== 'function') {
        throw new Error("First argument of create() must be a callback function, got " + typeof(stateCb));
      }
      var dependencies = Array.prototype.slice.call(arguments).slice(1);
      var options = {};
      var last = dependencies[dependencies.length - 1];
      if (typeof(last) === 'object' && last.constructor == Object) {
        options = dependencies.pop();
      }
      return new Validator(stateCb, dependencies, options);
    },
    Error: Result.ERROR,
    Queued: Result.QUEUED,
    Validating: Result.VALIDATING,
    Invalid: Result.INVALID,
    Valid: Result.VALID
  }
})();

try {
  module.exports = Validation;
} catch(e) {}
