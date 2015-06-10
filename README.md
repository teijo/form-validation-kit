# form-validation-kit

A small reactive JavaScript form validation library.


## Installation

You can install latest published package using npm and bower.

 - `bower install form-validation-kit`
 - `npm install form-validation-kit`


## Usage

See demos and usage on [project's Github Pages](https://teijo.github.io/form-validation-kit/).

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
