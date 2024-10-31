# NodeODM with VECROS AWS Integration

- to run on ec2 [run in sudo su]
    ```
    git pull && echo -e "AWS_ACCESS_KEY_ID=[writehere]\nAWS_SECRET_ACCESS_KEY=[writehere]" > .env && docker build -t my_nodeodm_image --no-cache . && docker run --env-file .env -p 3000:3000 my_nodeodm_image
    ```