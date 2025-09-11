#!/bin/bash
gunicorn app:flask_app -b 0.0.0.0:$PORT
