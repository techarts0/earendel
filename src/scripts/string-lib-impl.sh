#!/bin/bash


# Params: str
# Result: A number of str length
# Example: str_len "abc" ---> returns 3
function str_len(){
    if [ $# > 0 ]
    then
	local str=$1
	return ${#str}
    else
	echo "Parameter is required"
    fi
}

# Params: At least 2 strings
# Result: A string after concating
# Example: str_concat "ab" "cd" "ef" ---> returns "abcdef"
function str_concat(){
    if [ $# > 1 ]
    then
        local str=$*
        result=${str// /}
    else
	echo "At least 2 parameter are required"
    fi
}

# Params: str, str1
# Result: A number of index
# Example: str_indexof "abcd" "cd" ---> returns 2
# Example: str_indexof "abcd" "ss" ---> returns -1

function str_indexof(){
    echo "Who would like to help me implementing it?"
}


# Params: str, from, length
# Result: a string
# Example: str_sub "abcdef" 1, 2 ---> returns "bc"
function str_sub(){
    local str=$1
    local len=${#str}
    
    if [[ $2 -ge $len ]]
    then
        echo "Invalid index"
    else
        if [[ $3 -le 0 ]]
        then
            result=${str:$2}
        else
	    result=${str:$2:$3}
        fi
    fi
}

# Params: str, str1, order
# Result: The left string
# Example: str_delete "abcdabef" "ab" 0 ---> returns "cdabef"
# Example: str_delete "abcdabef" "ab" 1 ---> returns "abcdef"
function str_delete_first(){
    if [ $3 < 1 ] # 0
    then
        result=${$1#$2}
    else
	result=${$1%$2}
    fi
}

# Params: str, str1, str2
# Result: The replaced string
# Example: str_replace "abcdabef" "ab" "AB" 0 ---> returns "ABcdabef"
function str_replace(){
    if [[ $# -eq 3 ]]
    then
        result=${$1/$2/$3}
    else
	echo "Invalid parameters"
    fi
}

# Params: str, str1, str2
# Result: The replaced string
# Example: str_replace_all "abcdabef" "ab" "AB" ---> return "ABcdABef"
function str_replace_all(){
    if [[ $# -eq 3 ]]
    then
        result=${$1//$2/$3}
    else
        echo "Invalid parameters"
    fi
}

# Params: str, str1
# Result: 0: Equal; 1: Not equal
# Example: str_equal "ab" "ab" ---> returns 0
# Example: str_equal "ab" "ac" ---> returns 1
function str_equal(){
    if [[ $# -eq 2 ]]
    then
        if [ $1 == $2 ]
	then
	    return 0
	else
            return 1
	fi
    fi
}

# Params: str, separator
# Result: A string array splited
# Example: str_split "John,Tony,Mike" "," ---> returns （"John" "Tony" "Mike"）
function str_split(){
    if [[ $# -eq 2 ]]
    then
	local s=$2
	echo $s
	result=(${$1//$s/ })
    else
       echo "Invalid parameters"
    fi
}

#str_len
#echo $?
#str_concat "abc" "cde" "def"
#echo $result
str_split "ab,cd,ef" ","
echo $result
str_equal "ab" "cd"
echo $result
str_replace_all "abcdefab" "ab" 
echo $result
