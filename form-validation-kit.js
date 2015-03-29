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

  function Validator(parentStates, validators, options) {
    var input = new Bacon.Bus();
    var initialInput = new Bacon.Bus();
    var throttling = typeof(options.throttle) === 'number' ? options.throttle : DEFAULT_THROTTLE;
    var throttledInput = input.debounce(throttling);

    var hasAsyncValidators = validators.reduce(function(acc, v) { return acc || v.length > 1; }, false);
    var validationStream = validators.length == 0 ? Bacon.combineAsArray(parentStates) : throttledInput.merge(initialInput).flatMapLatest(function(event) {
      var responses = validators.map(validatorResponse(event));
      var ts = parentStates.concat(responses);
      return Bacon.combineAsArray(ts);
    });

    var streams = [];

    var requestQueued = input.map(function(i) {
      return {
        state: Result.QUEUED,
        response: []
      }
    });
    if (throttling > 0) {
      streams.push(requestQueued);
    }

    var requestSent = throttledInput.map(function(i) {
      return {
        state: Result.VALIDATING,
        response: []
      }
    });
    if (hasAsyncValidators) {
      streams.push(requestSent);
    }

    var response = validationStream.map(function(responseList) {
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
    });
    streams.push(response);

    var state = Bacon.mergeAll.apply(this, streams).skipDuplicates(function(prev, current) {
      return prev.state == current.state;
    }).toProperty();

    this.evaluate = function(value) {
      input.push({value: value});
    };
    this.__update = function(cb) {
      state.onValue(cb);
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

  function isChain(v) {
    return (v instanceof Validator);
  }

  function not(fn) {
    return function(val) {
      return !fn(val)
    }
  }

  return {
    create: function(cb /* ...validators, options */) {
      if (arguments.length < 2) {
        throw new Error("register() requires a callback and at least one validator as argument");
      }
      var dependencies = Array.prototype.slice.call(arguments).slice(1);
      var options = {};
      var last = dependencies[dependencies.length - 1];
      if (typeof(last) === 'object' && last.constructor == Object) {
        options = dependencies.pop();
      }
      var parents = dependencies.filter(isChain);
      var validators = dependencies.filter(not(isChain));

      validators.forEach(function(v) {
        var arity = v.length;
        if (arity < 1 || arity > 3) {
          throw new Error("Synchronous validator type is Function(string), asynchronous type is Function(string, done(bool, string), error(string)), got function taking " + arity + " arguments.");
        }
      });

      var parentStates = parents.map(function(p) { return p.__state; });
      var validation = new Validator(parentStates, validators, options);
      validation.__update(cb);
      return validation;
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
