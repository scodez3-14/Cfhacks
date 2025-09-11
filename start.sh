#!/bin/bash
gunicorn main:flask_app -b 0.0.0.0:$PORT
