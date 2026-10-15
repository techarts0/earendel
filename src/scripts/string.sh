#!/bin/bash
echo "A program to demostrate the string operations."


#Define or declare

name=Simon
name='Simon'
name="Simon"

# What's the difference of the above 3 methods?
# We strongly recommend you using the 3rd syntax to declare a string.

# How to retrieve the value of the string variable?
echo $name
echo ${name}

# The both of above are corret. The 2nd one is more suitable to be embedded it into a string:
echo "${name} is a great singer and song writer."

# The first way is using in a formal expression like:
name=$name" & Garfunkel"
echo $name
# It also demostrates how to concat 2 strings.

# Please note that the below is incorrect:
name=$name "& john denver"
echo "String concat is failed: ${name}"

# Get the length of string:
len=${#name}
echo "The length of \"${name}\" is ${len}"

# Slice the string (or substring)
slice=${name:0:5}
echo "The first 5 chars: ${slice}" 

# Slice(or substring) the string from index 8 to the tail
slice=${name:8}
echo "The chars from 8: ${slice}"

# Split string with the specified separator
men=(${name//&/ })
for man in ${men[*]}
    do
	echo $man
    done


#////////////////////////////////////////////////////////////////

content="She once was a true love of mine"

# Delete substring using regular express
# The marker "#" means deleting chars from the head with shortest match
# The marker "##" means deleting chars from the head with longest match

echo "Remove the "She" from the variable content: ${content#S*e}"
echo "Remove the the whole sentence from content: ${content##S*e}"

# The marker "%" means deleting chars from the tail with shortest match
# The marker "%%" means deleting chars from the tail with longest match
echo "Remove the "e of mine" from the variable content: ${content%e*e}"
echo "Remove the "e once was a true love of mine" from content: ${content%%e*e}"

# Replace (Search-Replace)
echo "Replace the first She with He: ${content/She/He}"
echo "Replace all e with the upper case letter E: ${content//e/E}"

# And, you can also using longest match but it's a little different to Substring:
echo "Replace the whole sentence of content: ${content/#S*e/Are you going to scarborough fair}"
echo "Replace the "e once was a true love of mine" with " is the best language": ${content/%e*e/ is the best language} "





# Delete the unused variable
unset content

# Compare 2 strings
tony="Tony"
if [ "Tony" == $tony ]
then
    echo "Tony equals Tony"

fi

if test "Tony" = $tony
then
    echo "Tony is tony!"
fi

if [ $tony != "tony" ]
then
    echo "Tony is not tony"
fi

