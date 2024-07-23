// rare
// found this in Google's text adventure console game

// listens for whenever variable "hi" is called on the window

Object.defineProperty(window, 'hi', {
    get: function () {
        console.log("hello there.");
    }
  });