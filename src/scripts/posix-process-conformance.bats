#!/usr/bin/env bats

@test "Bats run captures child output" {
  run echo process-probe
  assert_equal "$status" "0"
  assert_equal "$output" "process-probe"
}

@test "nested child exit status is preserved through waitpid" {
  run bash -c 'exit 7'
  assert_equal "$status" "7"
}

@test "nested child stdout is returned to its parent" {
  run bash -c 'echo child-output'
  assert_equal "$status" "0"
  assert_equal "$output" "child-output"
}
