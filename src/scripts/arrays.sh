#!/bin/bash


:<<EOF
Sometimes we want to write a long comments
on a few lines,
the multi-line comment is for you.
But it looks very urgly :(
EOF


# The separator of an array is blank char. It's different to other languages(,).

long_name="A hard rain is gonna fall"


singers=('John Denver' 'The brothers four' "Paul Simon" 'Bob Dylan')

favorites=('Country road' 'Try to remember' 'The sound of silence' ${long_name})

# Please think about why only a letter "A" is shown
echo ${favorites[3]}


# Please note how re-assign value to a variable
favorites[3]=${long_name}

# and, how to retrieve the value of a variable
echo ${favorites[3]}

# How to get the length of an array? There are 2 steps as following:
# 1. Expand the array as a list using operator */@. 
# 2. Using the operator # to calculate the length

echo "I like ${#singers[*]} singers and ${#favorites[@]} theirs most famous songs."

# so, the char * or @ index as above means all elements of an array

echo ${singers[*]}
echo ${singers[@]}

# Important!!! The array name represents the first element in the array
echo "I am ${singers[0]} and I am ${singers} too."

# If you want to get the index list of an array, the operator ! is for your purpose:
echo ${!singers[*]}

# Slicing an array is same with sub-string
echo ${singers[*]:0:2}

