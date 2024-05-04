#!/bin/bash

./node_modules/.bin/tsx worker/client.ts &

ollama serve &

wait -n
exit $?
