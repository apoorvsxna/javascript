let x = 15;

function f1()
{
    let x = 5; // overrides global value
    console.log(x);
}

function f2()
{
    let y = 6;
    console.log(y); // will work
    console.log(x); // will work, as x is globally scoped
}

f1();
f2();