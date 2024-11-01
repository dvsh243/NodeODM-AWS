# NodeODM with VECROS AWS Integration

- to run on ec2 [run in sudo su]
    ```
    git pull && echo -e "AWS_ACCESS_KEY_ID=[write_here]\nAWS_SECRET_ACCESS_KEY=[write_here]\nS3_FOLDER_NAME=[image_folder_name]" > .env && docker build -t my_nodeodm_image --no-cache . && docker run --env-file .env -p 3000:3000 my_nodeodm_image
    ```

- to build and update on dockerhub
    ```
    git pull && docker build --no-cache -t my_nodeodm_image . && docker tag my_nodeodm_image:latest devesh243/my_nodeodm_image:latest && docker push devesh243/my_nodeodm_image:latest
    ```