#!/bin/bash

process=$(ps -A)
echo $process

process=`ps -A`
echo $process

process=$(ps -A | grep sh > /tmp/ps.txt)

# Read string/chars/number from keyboard

read -p "Please key in your name:  " name
echo "Your name is ${name}"

# Read 10 chars from keyboard
read -n 10 name
echo "The first 10 chars of your name is:  " $name

# Read series as an array
read -a names

echo "You input ${#names[*]} names"

# The test instruction(test or [])
if [ -d /usr/local/rocwon ]
then
	echo "rocwon under /usr/local is a folder"
fi

if test -d /usr/local/rocwon
then
	echo "rocwon under /usr/local is a folder"
fi

# Using test checks file status:
# -f is file? 
# -d is folder?
# -e does exist?
# -r -w -x has the permission?
# -s is file name length great than 0?



if [ 2 -gt 1 ]
then
	echo "2 is great than 1"
fi

if test 2 -gt 1
then
	echo "2 is great than 1"
fi
