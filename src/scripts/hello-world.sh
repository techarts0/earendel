#!/bin/bash

# Please note that the path '/bin/bash' on ubuntu is linked to 'dash'!
# That means you run your script in dash interpreter but not in a real bash.
# The biggest difference between the 2 is dash can't recogonize the substitution of string using "${}".

# 1. echo is a statement like print to show message on the console.
# 2. a string needs to be braced in double quotes ("") or single quotes ('')

echo 'Hello world!'

echo "Hello everybody"


# How do we define a variable?
# The most important point you should remember is without any blanks at the both sides of assign operator.

# Error: name = 'Eric Clapton'

# The following declaration is correct:

words="Hello"

name='Eric Clapton'

# Use a declarated variable: 

echo ${words} ${name}

# Embed the variable into a string:
echo "${name} is a great rocker"


# Read something from console
read -p "Please key in a number: " -n 10 arg0
echo ${arg0}

read -p "Please enter your name: " arg0
echo ${arg0}

