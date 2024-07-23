// unpacks an iterable such as an array or a string.

let numbers = [1, 3, 7, 5, 0, 2];
console.log(...numbers); // basic usage

let max = Math.max(...numbers);
console.log(max);

const day = "tuesday";
let arr = [...day]; // can also be stored in array after unpacking
console.log(arr);

let fruits = ["apple", "orange", "banana"];
let vegetables = ["carrots", "celery", "potatoes"];
let foods = [...fruits, ...vegetables, "eggs", "milk"]; // can also be used together
console.log(foods);