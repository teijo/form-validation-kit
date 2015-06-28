# form-validation-kit

A small reactive JavaScript form validation library.


## Installation

You can install latest published package using npm and bower.

 - `bower install form-validation-kit`
 - `npm install form-validation-kit`


## Usage

See demos and usage on [project's Github Pages](https://teijo.github.io/form-validation-kit/).

### Synchronous

In example below, validator synchronously changes `<input>` background based on
input length.

```html
<input id="testInput" onkeyup="validateInput(event)">
```

```js
// Aggregator gets combined mapper state (see demo page) and does side-effects
function aggregator(state) {
  document.getElementById('testInput')
      .style.backgroundColor = (state == Validation.Invalid) ? 'pink' : 'white';
}

// Synchronous validation of input data
function mapLength(data) {
  return (data.length % 2 == 0);
}

// Init validator with aggregator and state mapper(s). State mappers turn
// .evaluate() inputs to state. Force initial aggregation with .using().
var validator = Validation.create(aggregator, mapLength).using('');

function validateInput(event) {
  validator.evaluate(event.target.value);
}
```

### Asynchronous

Asynchronous usage differs by having `done(boolean[, any])` callback as
second argument for mapper function. `done` is called when asynchronous
operation is ready. It takes validity boolean and optional second argument
that is passed to aggregator as response data.

```html
<input id="search" onkeyup="doSearch(event)">
```

```js
// Aggregator gets signaled when state changes. Data in responses array is
// filled in the order that the corresponding mapper functions were registered.
function aggregator(state, responses) {
  switch (state) {
    case Validation.Error:      // Exception thrown in mapper
    case Validation.Invalid:    // Mapper indicated failure with false
      indicateError("Problem performing search: " + responses.join(","))
      break;
    case Validation.Queued:      // Waiting throttle timeout
    case Validation.Validating:  // Waiting backend to respond
      indicateLoading();
      break;
    case Validation.Valid:       // Mapper indicated success with true
      showSearchResults(responses)
      break;
  }
}

function mapSearch(query, done) {
  var onError = function() { done(false, "Failed to perform search"); };
  var onComplete = function(result) { done(result.isValid, result.items); };
  asyncSearch(query, onComplete, onError);
}

// You can give additional settings for validation. {throttle: <ms>} *queues*
// input given amount of milliseconds. When there is <ms> of no input, latest
// input is passed to mapper functions.
var validator = Validation.create(aggregator, mapSearch, {throttle: 200}).using('');

function doSearch(event) {
  validator.evaluate(event.target.value);
}
```

### Options

```js
{
  // Milliseconds of required input idle time until latest value is passed to mappers.
  // default: 0
  throttle: <ms>
}
```

## Development

![Build status](https://codeship.com/projects/0925a1e0-2b10-0132-7a5d-06c98ad2d9ca/status?branch=gh-pages)

Install dependencies for testing:

```
bower install
npm install
```

To live reload code on browser and run tests on change run `npm start`.
Single test run `npm test`.

With live reload, open `index.html` in your browser. Saving `index.html` will
automatically reload it in the browser.
