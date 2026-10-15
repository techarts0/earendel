#!/bin/bash


# Way 1: Uses the keyword "function" to decleare a function
function echo_info(){
	echo "The length of the string: "
	prefix="That's why here we are"
	return ${#prefix}
}

# Way 2: Ignoring the keyword "function" is allowed.
# The shell function just allows to return an integer nubmer default as 0.
show_name(){
	echo "Your name is $1"
	echo "You are $2 years"
	echo "and you are a $3."
	return 3
}

# How many parameters did caller pass?
show_parameter_numbers(){
    echo $#
}

# The result of function after calling is $?
show_name aaa bbb ccc
echo $?

# The scope of a variable in shell is global defaultly, we can use the keyword "local" to limit it in the function.
add(){
	local sum=0;
	let sum=($1 + $2);
	return $sum;
}

add 2 3

echo $?

# Calls the functions defined above. In many languages, the brackets pair is required while functiong calling but shell not. 

# Without arguments
echo_info

echo $?

# With arguments. 
#Please note that the separator of these arguments is a blank space " "

show_name "Mike" 22 "Coder"

add 234 345

echo "The sum of 234 and 345 is ${$?}"

