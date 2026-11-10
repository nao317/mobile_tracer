FROM alpine:3.23
RUN apk add --no-cache python3 py3-pillow postgresql17-client
WORKDIR /work
COPY mock.py data.py seed.sql test_data.py ./
COPY config ./config
