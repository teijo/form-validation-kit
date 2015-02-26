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
  return function() {
    return Array.prototype.slice.apply(promises).reduce(function(agg, arg) {
      return agg.then(arg);
    }, new Promise(function(r) {r()}));
  }
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

function unreg(validator) {
  return function() {
    validator().unregister();
  }
}

function eval(validator, cb) {
  return function() {
    return validator().evaluate("", cb);
  }
}

function log(msg) {
  return function() {
    console.log(msg);
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
});

function poll(/*...checkCbs*/) {
  var checkCbs = Array.prototype.slice.apply(arguments);
  return function() {
    return new Promise(function(resolve) {
      var timer = -1;
      function loop() {
        if (checkCbs.reduce(function(agg, cb) {
              return agg && cb();
            }, true)) {
          clearTimeout(timer);
          resolve();
        }
      }
      timer = setInterval(loop, 100);
      loop();
    });
  };
}

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

      var a = form.register(alwaysValid, {init: "XXX", throttle: 100});
      var b = null;
      var aStates = [];
      var bStates = [];

      var combined = wrap(combinedState);
      var As = wrap(aStates);
      var Bs = wrap(bStates);

      seq(poll(eq(combined, [V.Valid])),
          eval(function() { return a; }, function(state){ aStates.push(state.state); }),
          poll(eq(As, [V.Waiting, V.Validating, V.Valid])),
          poll(eq(combined, [V.Valid, V.Waiting, V.Validating, V.Valid])),
          function(){ b = form.register(alwaysInvalid, {init: "", throttle: 0}); },
          eval(function() { return b; }, function(state){ bStates.push(state.state); }),
          poll(eq(last(Bs), [V.Invalid])),
          poll(eq(last(As), [V.Valid]), eq(last(Bs), last(combined), [V.Invalid])),
          unreg(function() { return b; }),
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
    form.register(expectError, {throttle: 0}).evaluate("", function(state) {
      assert.equal(state.state, evalStates.shift(1));
    });
  });
});

