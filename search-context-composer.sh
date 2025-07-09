#!/bin/bash

echo "Searching for 'context-composer' in all git repositories..."
echo "============================================="
echo

cd ~/code

for dir in */; do
  if [ -d "${dir}.git" ]; then
    cd "$dir"
    results=$(git grep -l "context-composer" 2>/dev/null)
    if [ ! -z "$results" ]; then
      echo "Repository: ${dir%/}"
      echo "$results" | while read file; do
        echo "  - $file"
      done
      echo
    fi
    cd ..
  fi
done

echo "============================================="
echo "Search complete."