function f1()
{
    let x = 5;
    console.log(x);
}

function f2()
{
    let y = 6;
    console.log(y); // will work
    console.log(x); // will give error, x is locally scoped in f1.
}

f1();
f2();