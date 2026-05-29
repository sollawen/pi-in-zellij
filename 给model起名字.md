我的想法
- pi-in-zellij在每次初始化的时候，读取config.json之后，
    - 就检查一下assistants里面的model是否真实存在
    - 这需要找pi读取它当前所有有效的model list
    - 如果都有效，平安无事
    - 如果有一个以上的model是无效的，就说明需要用户重新配置一下了
- 我赞成搞一个 /susmmon-setup,
    - 读取pi当前有效的 modelList
    - 让用户给他喜欢用的model起名字
    - 然后保存到config.json

我这里有几个问题需要你来查找资料确认的
- 如何读取pi当前有效的modelList
- config.json文件应该是在哪里？
