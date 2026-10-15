#!/usr/bin/bash

# The following lines described how to define a string variable


# Single-Quote, Double-Quotes or without quote are all legal
gender=male
name='John Denver'
career="Singer"

# In some language such as Java, we can use the operator "+" concatenating 2 strings
career=''${career}' and '

career=${career}'Song writer'


# We can't change its value if a variable is declared with the modifier "readonly"
readonly address="West Virgina"


content="She once was a true love of mine"


# Firstly, we can use the strings those are defined above.'
echo $name
echo "${name} is a $gender"

# If a variable are wrote in a string without a pair of single quotes, it's shown directly. 
echo 'This is not what we expected: ${name} is a ${gender}'

# The following line works fine:
echo 'Good job! '${name}' is a '${gender}''

echo
# Concatentes the above variables in whole line
echo "${name} is a $gender, he is a famous ${career} and lives in $address."
echo

# Like other languages, we can manipulate the string

# The operator "#" is to calculate the length of the string like len, length, or size in other languages.
echo 'The length of the string career is : '${#career}

# Substring | Slice
echo 'The first 4 chars of the variable address: '${address:0:4}''

echo "Obtain the last 8 chars of the variable address: ${address:5}"

# Delete substring using regular express
# The marker "#" means deleting chars from the head with shortest match
# The marker "##" means deleting chars from the head with longest match
echo "Remove the "She" from the variable content: ${content#S*e}"
echo "Remove the whole sentence from content: ${content##S*e}"

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


# There are many methods can split a string to parts according to the given separator, but the following
# is the most easy and efficient: Replace the separator to a space. 
words=(${content// / })

echo "The first word in content is: ${words[0]}"

# You can delete the variable if you don't want to use it.
unset words

# echo "An error here: ${words[1]}"

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

