var V = require('./form-validation-kit');
var assert = require("assert");

function expectOk(value, done) {
  setTimeout(function() {
    done(value === "ok");
  }, 0)
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
    form.validator(expectOk, {throttle: 0}).evaluate("ok", function(state) {
      assert.equal(state.state, evalStates.shift(1));
    });
  })
});

