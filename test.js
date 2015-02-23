var V = require('./form-validation-kit');
var assert = require("assert");

function expectOk(value, done) {
  done(value === "ok");
}

describe('Input', function() {
  it('triggers Valid state', function(done) {
    var form = V.Create(function(state) {
      if (state.state === V.Valid) {
        done();
      }
    });

    form.validator(expectOk).evaluate("ok", function(state) { });
  })
});

