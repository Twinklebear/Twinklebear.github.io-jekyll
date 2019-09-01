#!/bin/bash

cd assets/img/gh-cards/Twinklebear/

for f in `ls *.svg`; do
    echo "Fetching updated SVG for $f"
    rm $f
    wget https://gh-card.dev/repos/Twinklebear/$f 
done

cd ../../../../

