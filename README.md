To get your callers in the InterBBS last callers list you'll need to add a hook to your custom logon script.  Here's how:

1. In your script, load the library at the top so it's ready to go: `load("/sbbs/xtrn/interbbs-last-callers/interbbs-logon.js");`
2. At some point you'll want to call the function `interbbsLogon();` to register an interBBS login, it'll probably work anywhere in your custom logon script, and do it's job silently (no visuals to user).  
