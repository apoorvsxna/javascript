// bundles multiple elements into an array

function fridge(...food) // bundles all arguments into an array "foods"
{
    return food;
}

let bundle = fridge("mangoes", "cheese", "pizza", "sprite");
console.log(bundle);