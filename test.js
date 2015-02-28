var V = require('./form-validation-kit');
var assert = require("assert");
var Promise = require("bluebird");
var _ = require("lodash");

function expectOk(value, done) {
  setTimeout(function() {
    done(value === "ok");
  }, 0)
}

function alwaysValid(_, done) {
  setTimeout(function(){
    done(true);
  }, 0);
}

function alwaysInvalid(_, done) {
  setTimeout(function(){
    done(false);
  }, 0);
}

function expectError(value, done, error) {
  setTimeout(function() {
    error("Problem")
  }, 0)
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

function pass(sequence) {
  return function(value) {
    return sequence().then(value);
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

function unregister(validator) {
  validator.unregister();
}

function evaluate(cb) {
  return function(validator) {
    validator.evaluate("", cb);
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

describe('Input', function() {
  it('triggers Valid state', function(done) {
    var createStates = [V.Waiting, V.Validating, V.Valid];
    var form = V.Create(function(state) {
      assert.equal(state.state, createStates.shift(1));
      if (state.state === V.Valid) {
        done();
      }
    });

    var evalStates = [V.Waiting, V.Validating, V.Valid];
    form.register(expectOk, {throttle: 0}).evaluate("ok", function(state) {
      assert.equal(state.state, evalStates.shift(1));
    });
  });

  it('minimum idle time for triggering validation can be set', function(done) {
    var combinedStates = [];
    var form = V.Create(function(state) { combinedStates.push(state.state); });
    var m = function(x) { return x * 10 };
    var threshold = 5;

    seq(register(form, alwaysValid, {throttle: m(threshold)}),
        evaluate(function(state) { }),
        sleep(m(2)),
        evaluate(function(state) { }),
        sleep(m(3)),
        evaluate(function(state) { }),
        sleep(m(4)),
        isTrue(eq(combinedStates, [V.Waiting])),
        sleep(m(threshold + 1)),
        isTrue(eq(combinedStates, [V.Waiting, V.Validating, V.Valid])),
        call(done))();
  });

  it('triggers callback only for last evaluation per validator', function(done) {
    var combinedStates = [];
    var form = V.Create(function(state) { combinedStates.push(state.state); });
    var m = function(x) { return x * 10 };
    var threshold = 5;

    var states = [];
    seq(register(form, alwaysValid, {throttle: m(threshold)}),
        evaluate(function(state) { states.push({a: state.state}); }),
        sleep(m(2)),
        evaluate(function(state) { states.push({b: state.state}); }),
        sleep(m(threshold + 1)),
        isTrue(eq(states, [{a: V.Waiting}, {b: V.Validating}, {b: V.Valid}])),
        call(done))();
  })
});

describe('Unregister', function() {
  describe('on single validator', function() {
    var validator = null;

    beforeEach(function() {
      validator = V.Create().register(alwaysValid);
    });

    it('succeeds on first try', function() {
      assert.doesNotThrow(function() {
        validator.unregister();
      });
    });

    it('fails on second try', function() {
      assert.doesNotThrow(function() {
        validator.unregister();
      });
      assert.throws(
          function() { validator.unregister(); },
          /Cannot unregister. unregister\(\) can be called only once for validator./);
    });

    it('fails on evaluate', function() {
      validator.unregister();
      assert.throws(
          function() { validator.evaluate(true); },
          /Cannot evaluate. unregister\(\) has been called for this validator earlier./);
    });
  });

  describe('on multiple validators', function() {
    it('restores invalid state', function(done) {
      var combinedState = [];
      var form = V.Create(function(state) {
        combinedState.push(state.state);
      });

      var aStates = [];
      var bStates = [];

      var combined = wrap(combinedState);
      var As = wrap(aStates);
      var Bs = wrap(bStates);

      seq(register(form, alwaysValid, {init: "XXX", throttle: 100}),
          poll(eq(combined, [V.Valid])),
          evaluate(function(state){ aStates.push(state.state); }),
          poll(eq(As, [V.Waiting, V.Validating, V.Valid])),
          poll(eq(combined, [V.Valid, V.Waiting, V.Validating, V.Valid])),
          register(form, alwaysInvalid, {init: "", throttle: 0}),
          evaluate(function(state){ bStates.push(state.state); }),
          poll(eq(last(Bs), [V.Invalid])),
          poll(eq(last(As), [V.Valid]), eq(last(Bs), last(combined), [V.Invalid])),
          unregister,
          poll(eq(last(combined), [V.Valid])),
          done)();
    })
  })
});

describe('Error', function() {
  it('triggers Error state', function(done) {
    var createStates = [V.Waiting, V.Validating, V.Error];
    var form = V.Create(function(state) {
      assert.equal(state.state, createStates.shift(1));
      if (state.state === V.Error) {
        done();
      }
    });

    var evalStates = [V.Waiting, V.Validating, V.Error];
    seq(register(form, expectError, {throttle: 0}),
        evaluate(function(state) {
          assert.equal(state.state, evalStates.shift(1));
        }))();
  });
});

