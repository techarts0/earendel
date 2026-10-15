#!/bin/bash

echo
echo "***Calculator 4 Shell***"
echo
echo "The calculator receipts an express eg. 1 + 2, 6 * 3"
echo "These operators are supported: +, -, *, /, ^, %"
echo "IMPORTANT: the space is required between each part."
echo "For example: 1+2, 3/4, 2^5 are illegal, but 1 + 2, 3 / 4 are allowed."
echo

check_zero(){
    if [[ $1 != "/" && $1 != "%" ]]
    then
	    return 0
    fi

    if [ $2 -eq 0 ]
    then
	    return 1
    else
	    return 0
    fi
}


while true
do
    read -p "Please input your expresion: " -a args

    check_zero ${args[1]} ${args[2]}
    
    if [ $? -eq 1 ]
    then
	    echo "Divide by zero!"
    else
        result=0

        case ${args[1]} in
        '+')
	        result=$((args[0] + args[2]));;
        '-')
	        result=$((args[0] - args[2]));;
        '*')
	        result=$((args[0] * args[2]));;
        '/')
	        result=$(echo "scale=4;${args[0]} / ${args[2]}" | bc);;
        '%')
	        result=$((args[0] % args[2]));;
        '^')
	        result=$((args[0] ** args[2]));;
        *)
	        echo "I guess you wanna exit, goodbye!"
	        break
        esac

        echo "The result is: ${result}"

        echo "${args[0]} ${args[1]} ${args[2]} = ${result}" >> /tmp/cal-history.txt
    fi
done
