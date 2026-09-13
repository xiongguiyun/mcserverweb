# 第三方代码说明

## sliding-vertify-vue

本项目的原生 JavaScript 滑块验证码复用了
[`sliding-vertify-vue`](https://github.com/jia-allen/sliding-vertify-vue)
的拼图路径、双 Canvas 裁切、滑动状态和轨迹标准差校验思路。

原项目作者：MrXujiang  
许可证：MIT

本项目对其 Vue 组件进行了原生 JavaScript 适配，并将图片加载替换为本地 Canvas 背景生成；登录挑战生成、服务端校验和一次性消费逻辑属于本项目代码。

