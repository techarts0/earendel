#!/bin/bash


scores=(82 95 77 88 59)

i=2
j=3

# Express(expr) mode is very hard to understand, so we just need to know it how's going.
sum=`expr $i + $j`

sum=$(expr $i + $j)


# Double-brackets mode is recommended because it is easy to use.
# You can write expression of CLANG style in a pair of brackets.
sum=$((i + j))

echo ${sum}

sum=$((scores[0] + scores[1] + scores[2] + scores[3] + scores[4]))

echo ${sum}

len=${#scores[@]}

# Let expression is same to double-brackets, I strongly recomend you to use it in your code.

let avg=(sum / len)

echo ${avg}

let sum=(scores[0] + scores[1] + scores[2] + scores[3] + scores[4])
echo $((sum / len))


# The float numeric is not supported in shell/bash, the utility bc can helps us to handle it. 
# Maybe you need to install bc via the command "sudo apt-get install bc"
# Looks very very very awkward...

f=$(echo "scale=2;2.5 + 3.5" | bc)
echo $f

f=$(echo "scale=2;3 / 2" | bc)
echo ${f}

# Please pay more attention to the blank space, it's illegal in shell. 
# If you want to use it in your code, please let it in a pair of brackets. 

let val=2+3
let val=(2 + 3)
echo $val
