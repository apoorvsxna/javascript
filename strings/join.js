function fruits(...f)
{
    let s = f.join(" "); // joins all elements of array into a string while separating them with the given string (here " ")
    return s;
}

let allFruits = fruits("apple", "banana", "melon");
console.log(allFruits);