var V = require('./form-validation-kit');
var assert = require("assert");
var Promise = require("bluebird");
var _ = require("lodash");

function expectOk(value, done) {
  setTimeout(function() {
    done(value === "ok");
  }, 0)
}

function min3(value, done) {
  setTimeout(function() {
    done(value.length >= 3, 'Value must be at least 3 long, got ' + value);
  }, 0)
}

function validWithDelay(delay) {
  return function(_, done, error) {
    setTimeout(function(){
      done(true);
    }, delay);
  }
}

function validResponse(data) {
  return function(value, done, error) {
    setTimeout(function(){
      done(true, data);
    }, 10);
  }
}

function alwaysValid(_, done, error) {
  setTimeout(function(){
    done(true);
  }, 0);
}

function expectError(value, done, error) {
  setTimeout(function() {
    error("Problem")
  }, 0)
}

function synchronousValid(_) {
  return;
}

function seq() {
  var promises = arguments;
  return function(value) {
    var sequence = Array.prototype.slice.apply(promises).reduce(function(agg, arg) {
      return agg.then(arg);
    }, new Promise(function(r) {r(value)}));
    return sequence.return(value);
  }
}

function call(fn) {
  return function() {
    fn()
  };
}

function unwrap(x) {
  if (typeof(x) === 'function') {
    return x();
  } else {
    return x;
  }
}

function eq(/*...values*/) {
  var items = Array.prototype.slice.call(arguments);
  if (items.length < 2) {
    throw new Error('Must give at least two arguments to compare, got ' + items.length);
  }
  return function() {
    var first = unwrap(items[0]);
    return items.map(unwrap).reduce(function(agg, it) {
      return agg && _.isEqual(first, it);
    }, true);
  }
}

function register(form, validator, opts) {
  var registerArgs = Array.prototype.slice.apply(arguments).slice(1);
  return function() {
    return form.register.apply(this, registerArgs);
  }
}

function evaluate(value) {
  return function(validator) {
    validator.evaluate(value || "");
    return validator;
  }
}

function log(msg) {
  return function(value) {
    console.log(msg, value);
    return value;
  }
}

function wrap(ptr) {
  return function() {
    return ptr;
  }
}

function last(fn) {
  return function() {
    return fn().slice(-1);
  };
}

function isTrue(fn) {
  return function(value) {
    assert.equal(fn(), true);
    return value;
  }
}

function sleep(ms) {
  return function(value) {
    return (new Promise(function(resolve) {
      setTimeout(resolve, ms);
    })).return(value);
  }
}

function poll(/*...checkCbs*/) {
  var checkCbs = Array.prototype.slice.apply(arguments);
  return function(value) {
    return new Promise(function(resolve) {
      var timer = -1;
      function loop() {
        if (checkCbs.reduce(function(agg, cb) {
              return agg && cb();
            }, true)) {
          clearTimeout(timer);
          resolve(value);
        }
      }
      timer = setInterval(loop, 100);
      loop();
    });
  };
}

function pushState(array) {
  return function(state) {
    array.push(state.state);
  }
}

function pushResponse(array) {
  return function(state) {
    array.push(state.response);
  }
}

var nop = function() {};

describe('Input for asynchronous validator', function() {
  it('triggers Valid state', function(done) {
    var createStates = [V.Queued, V.Validating, V.Valid];
    var form = V.create(function(state) {
      assert.equal(state.state, createStates.shift(1));
      if (state.state === V.Valid) {
        done();
      }
    }, expectOk, {throttle: 10});

    form.evaluate("ok");
  });

  it('minimum idle time for triggering validation can be set', function(done) {
    var m = function(x) { return x * 10 };
    var threshold = 5;
    var combinedStates = [];
    var form = V.create(pushState(combinedStates), alwaysValid, {throttle: m(threshold)});

    seq(function() { return form; },
        evaluate(),
        sleep(m(2)),
        evaluate(),
        sleep(m(3)),
        evaluate(),
        sleep(m(4)),
        isTrue(eq(combinedStates, [V.Queued])),
        sleep(m(threshold + 1)),
        isTrue(eq(combinedStates, [V.Queued, V.Validating, V.Valid])),
        call(done))();
  });

  it('triggers evaluation callback based on correct state', function(done) {
    var combinedStates = [];
    var m = function(x) { return x * 10 };
    var threshold = 1;
    var form = V.create(pushState(combinedStates), min3, {throttle: m(threshold)});

    seq(function() { return form; },
        evaluate("1"),
        sleep(m(threshold + 1)),
        evaluate("12"),
        sleep(m(threshold + 1)),
        evaluate("123"),
        sleep(m(threshold + 1)),
        isTrue(eq(combinedStates, [
          V.Queued, V.Validating, V.Invalid, // 1
          V.Queued, V.Validating, V.Invalid, // 12
          V.Queued, V.Validating, V.Valid    // 123
        ])),
        call(done))();
  });

  it('while validating will revert back to queueing', function(done) {
    var combinedStates = [];
    var form = V.create(pushState(combinedStates), validWithDelay(100), {throttle: 10});

    seq(function() { return form; },
        evaluate(),
        sleep(50),               // Wait to start validation
        evaluate(),           // Interrupt ongoing validation
        sleep(200),              // Wait validation to resolve
        isTrue(eq(combinedStates, [
          V.Queued, V.Validating, V.Queued, V.Validating, V.Valid
        ])),
        call(done))();
  });

  it('same throttle and validation delay', function(done) {
    var combinedStates = [];
    var form = V.create(pushState(combinedStates), validWithDelay(100), {throttle: 100});

    seq(function() { return form; },
        evaluate('a'),
        sleep(150),
        evaluate('b'),
        log(combinedStates),
        sleep(300),
        log(combinedStates),
        poll(eq(combinedStates, [
          V.Queued, V.Validating, V.Queued, V.Validating, V.Valid
        ])),
        call(done))();
  });

  it('can return an object to state callback', function(done) {
    var combinedStates = [];
    var responses = [];
    var form = V.create(function(state) {
      pushState(combinedStates)(state);
      pushResponse(responses)(state) ;
    }, validResponse({foo: "bar"}));

    seq(function() { return form; },
        evaluate(),
        poll(eq(combinedStates, [
          V.Validating, V.Valid
        ])),
        poll(eq(responses, [
          [], [{foo: "bar"}]
        ])),
        call(done))();
  });
});

describe('Input for synchronous validator', function() {
  it('gets queued with throttling', function(done) {
    var combinedStates = [];
    var form = V.create(pushState(combinedStates), synchronousValid, {throttle: 100});

    seq(function() { return form; },
        evaluate(),
        poll(eq(combinedStates, [
          V.Queued, V.Valid
        ])),
        call(done))();
  });

  it('leads to immediate valid state', function(done) {
    var combinedStates = [];
    var form = V.create(pushState(combinedStates), synchronousValid, {throttle: 0});

    seq(function() { return form; },
        evaluate(),
        evaluate(),
        evaluate(),
        evaluate(),
        evaluate(),
        eq(combinedStates, [V.Valid]),
        call(done))();
  })
});

describe('Parent validator', function() {
  it('gets queued with throttling', function(done) {
    var parentStates = [];
    var childStates = [];
    var parent = V.create(pushState(parentStates), alwaysValid);
    var child = V.create(pushState(childStates), parent);

    seq(function() { return parent; },
        evaluate(),
        poll(eq(parentStates, [
          V.Validating, V.Valid
        ])),
        function() { return child; },
        poll(eq(childStates, [
          V.Validating, V.Valid
        ])),
        call(done))();
  });
});

describe('Registration', function() {
  function arityError(arity) {
    return new RegExp("Synchronous validator type is Function\\(string\\), asynchronous type is Function\\(string, done\\(bool, string\\), error\\(string\\)\\), got function taking " + arity + " arguments.", "g");
  }

  it('throws exception with too few callback arguments', function() {
    assert.throws(function() {
      V.create(nop, nop);
    }, arityError(0));
  });

  it('throws exception with too many callback arguments', function() {
    assert.throws(function() {
      V.create(nop, function(a, b, c, d) {});
    }, arityError(4));
  });
});

describe('Error', function() {
  it('triggers Error state', function(done) {
    var createStates = [V.Queued, V.Validating, V.Error];
    var form = V.create(function(state) {
      assert.equal(state.state, createStates.shift(1));
      if (state.state === V.Error) {
        done();
      }
    }, expectError, {throttle: 10});

    var evalStates = [V.Queued, V.Validating, V.Error];
    seq(function() { return form; },
        evaluate(function(state) {
          assert.equal(state.state, evalStates.shift(1));
        }))();
  });
});
