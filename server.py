import json
import requests
import asyncio
import re
import base64
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, Request, UploadFile, File,HTTPException,Body
import os
import glob
from fastapi import FastAPI, HTTPException
from typing import List, Dict, Any
import json

app = FastAPI()

# 挂载静态文件
app.mount("/static", StaticFiles(directory="web_demo/static"), name="static")

def get_audio(text_cache, voice_speed, voice_id):
    # 读取一个语音文件模拟语音合成的结果
    with open("web_demo/static/common/test.wav", "rb") as audio_file:
        audio_value = audio_file.read()
    base64_string = base64.b64encode(audio_value).decode('utf-8')
    return base64_string

def llm_answer(prompt):
    # 模拟大模型的回答
    answer = "我会重复三遍来模仿大模型的回答，我会重复三遍来模仿大模型的回答，我会重复三遍来模仿大模型的回答。"
    return answer

def split_sentence(sentence, min_length=10):
    # 定义包括小括号在内的主要标点符号
    punctuations = r'[。？！；…，、()（）]'
    # 使用正则表达式切分句子，保留标点符号
    parts = re.split(f'({punctuations})', sentence)
    parts = [p for p in parts if p]  # 移除空字符串
    sentences = []
    current = ''
    for part in parts:
        if current:
            # 如果当前片段加上新片段长度超过最小长度，则将当前片段添加到结果中
            if len(current) + len(part) >= min_length:
                sentences.append(current + part)
                current = ''
            else:
                current += part
        else:
            current = part
    # 将剩余的片段添加到结果中
    if len(current) >= 2:
        sentences.append(current)
    return sentences


import asyncio
async def gen_stream(prompt, asr = False, voice_speed=None, voice_id=None):
    print("XXXXXXXXX", voice_speed, voice_id)
    if asr:
        chunk = {
            "prompt": prompt
        }
        yield f"{json.dumps(chunk)}\n"  # 使用换行符分隔 JSON 块

    text_cache = llm_answer(prompt)
    sentences = split_sentence(text_cache)

    for index_, sub_text in enumerate(sentences):
        base64_string = get_audio(sub_text, voice_speed, voice_id)
        # 生成 JSON 格式的数据块
        chunk = {
            "text": sub_text,
            "audio": base64_string,
            "endpoint": index_ == len(sentences)-1
        }
        yield f"{json.dumps(chunk)}\n"  # 使用换行符分隔 JSON 块
        await asyncio.sleep(0.2)  # 模拟异步延迟

# 处理 ASR 和 TTS 的端点
@app.post("/process_audio")
async def process_audio(file: UploadFile = File(...)):
    # 模仿调用 ASR API 获取文本
    text = "语音已收到，这里只是模仿，真正对话需要您自己设置ASR服务。"
    # 调用 TTS 生成流式响应
    return StreamingResponse(gen_stream(text, asr=True), media_type="application/json")


async def call_asr_api(audio_data):
    # 调用ASR完成语音识别
    answer = "语音已收到，这里只是模仿，真正对话需要您自己设置ASR服务。"
    return answer

@app.post("/eb_stream")    # 前端调用的path
async def eb_stream(request: Request):
    try:
        body = await request.json()
        input_mode = body.get("input_mode")
        voice_speed = body.get("voice_speed")
        voice_id = body.get("voice_id")

        if input_mode == "audio":
            base64_audio = body.get("audio")
            # 解码 Base64 音频数据
            audio_data = base64.b64decode(base64_audio)
            # 这里可以添加对音频数据的处理逻辑
            prompt = await call_asr_api(audio_data)  # 假设 call_asr_api 可以处理音频数据
            return StreamingResponse(gen_stream(prompt, asr=True, voice_speed=voice_speed, voice_id=voice_id), media_type="application/json")
        elif input_mode == "text":
            prompt = body.get("prompt")
            return StreamingResponse(gen_stream(prompt, asr=False, voice_speed=voice_speed, voice_id=voice_id), media_type="application/json")
        else:
            raise HTTPException(status_code=400, detail="Invalid input mode")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def get_avatar_info(path: str) -> Dict[str, Any]:
    """从路径中提取角色信息"""
    avatar_id = os.path.basename(path)
    avatar_name = avatar_id

    path = "assets/{}".format(os.path.basename(path))
    # 检查必要的文件是否存在
    thumbnail_path = os.path.join(path, "thumbnail.jpg")
    combined_data_path = os.path.join(path, "combined_data.json.gz")
    video_url = os.path.join(path, "01.webm")

    return {
        "avatar_id": avatar_id,
        "avatar_name": avatar_name,
        "avatar_url": thumbnail_path,
        "video_asset_url": combined_data_path,
        "video_url": video_url,
        "bg_id": "002",
    }


def get_background_info(path: str) -> Dict[str, Any]:
    """从路径中提取背景信息"""
    bg_id = os.path.basename(path)

    path = "background/{}".format(os.path.basename(path))

    is_video = False
    thumbnail_url = os.path.join(path, "thumbnail.jpg")
    bg_url = os.path.join(path, "bg.jpg")

    current_dir = os.path.dirname(os.path.abspath(__file__))
    assets_bg_url = os.path.join(current_dir, "static", bg_url)
    if not os.path.exists(assets_bg_url):
        bg_url = os.path.join(path, "bg.mp4")
        is_video = True

    return {
        "bg_id": bg_id,
        "bg_url": bg_url,
        "is_video": is_video,
        "thumbnail_url": thumbnail_url
    }


@app.get("/get_roles")
async def get_roles():
    """获取所有角色数据"""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    assets_dir = os.path.join(current_dir, "static/assets")
    if not os.path.exists(assets_dir):
        raise HTTPException(status_code=404, detail="Assets directory not found")

    roles = []
    for path in glob.glob(os.path.join(assets_dir, "*")):
        if os.path.isdir(path):
            roles.append(get_avatar_info(path))
    print("XXX", roles)
    return roles


@app.get("/get_backgrounds")
async def get_backgrounds():
    """获取所有背景数据"""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    bg_dir = os.path.join(current_dir, "static/background")
    if not os.path.exists(bg_dir):
        raise HTTPException(status_code=404, detail="Background directory not found")

    backgrounds = []
    for path in glob.glob(os.path.join(bg_dir, "*")):
        if os.path.isdir(path):
            backgrounds.append(get_background_info(path))
    print("XXX", backgrounds)
    return backgrounds

from datetime import datetime, timedelta
@app.post("/api/auth/role_secret")
async def role_secret(data: dict = Body(...)):
        print("role_secret", data)
        # 参数校验
        unionid = data.get("unionid")
        avatar_id = data.get("avatar_id")

        if not unionid or not avatar_id:
            raise HTTPException(status_code=400, detail="缺少必要参数")
        print("role_secret", 11)

        current_time_utc = datetime.utcnow()
        key = "MatesX_001M"
        from encrypt import generate_secret
        new_secret = generate_secret(avatar_id, key)
        # 计算新过期时间（UTC时间 + 2天）
        new_expire_time_utc = current_time_utc + timedelta(days=2)
        new_expire_time_str = new_expire_time_utc.strftime("%Y-%m-%d %H:%M:%S")

        return {
            "avatar_id": avatar_id,
            "secret": new_secret,
            "expire_time": new_expire_time_str
        }

# 启动Uvicorn服务器
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888)
