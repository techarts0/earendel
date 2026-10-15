#!/bin/bash

:<<EOF
     if
     then
     else
     fi
EOF

a=1
b=2

# There are several ways to write the conditions in if statement:

# 1. Using test expression
if test $a -gt $b
then
    echo "a is great than b"
fi

# 2. In a pair of square brackets
if [ $a -gt $b ]
then
    echo "a is less than b"
fi

# 3. In double pairs of square brackets ( !!! )
if [[ a -gt b ]]
then
	echo "Is a less than b???"
fi

# 4. In double pairs of square brackets. It's strongly recommended.

if ((a > b)) 
then
	echo 'a is great than b'
elif test $a -lt $b 
then
	echo 'a is less than b'
else
	echo 'a equals b'
fi


array=("The brothers four" "John Denver" "Paul Simon" "Bob Dylan")

echo "There are ${#array[@]} singers."
echo "The index of singers: ${!array[*]}"

# Case statement for multiple branches

read -p "Type a command:  " cmd

case $cmd in
	"help")
		echo "help | exit | login | run";;
	"exit")
		echo "Exit Jinux, bye!";;
	"login")
		echo "Welcome to Jinux";;
	"run")
		echo "Jinux is running now";;
	*)
		echo "Sorry I can't understand what you entered."
esac


# The first way to iterate the array
for singer in ${array[*]}
do
	echo ${singer}
done


# The second way to iterate the array
for((i = 0;i < ${#array[*]};i++))
do
	echo ${array[i]}
done


# The third way is to access elements via index
for i in ${!array[*]}
do
	echo ${array[i]}
done

# Generate a sequence
for i in $(seq 0 100)
do
    echo "seq: $i"
done


# In a given range
for i in {0..6}
do
    echo "seq: $i"
done

# While loop

loop=0
size=${#array[*]}

while ((loop < $size))
do
    echo ${array[loop]}
    ((loop++))
done

