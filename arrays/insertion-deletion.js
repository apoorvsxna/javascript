let numbers = [1, 3, 5, 7, 0, 2];

numbers[2] = 15; // change value at 2nd index

numbers.push(20); // insert at end
numbers.push(24);
numbers.pop(); // remove from end

numbers.unshift(30); // add at beginning
numbers.unshift(50);
numbers.shift(); // remove from beginning

console.log(numbers);