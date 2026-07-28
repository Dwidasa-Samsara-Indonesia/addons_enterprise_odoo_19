-- neutralize TikTok Shop API credentials
UPDATE tiktok_shop
   SET tiktok_shop_ref = 1,
        tiktok_cipher = 'dummy',
        app_secret = 'dummy',
        service_extern_id = 'dummy',
        access_token = 'dummy',
        refresh_token = 'dummy';
