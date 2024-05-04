#!/bin/bash

ollama serve &

sleep 1

./node_modules/.bin/tsx worker/client.ts &

wait -n
exit $?
