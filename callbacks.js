hello(goodbye);

function hello(callback) // guarantee bye is called after hello
{
    setTimeout(()=>console.log("hello"), 3000); //set delay
    callback();
}

function goodbye()
{
    console.log("bye");
}