# 我希望的效果是这样的

## startup场景
如果config里面没有任何的助理，说明用户是第一次使用这个版本，或是被用户自己删光了
- 提示“请给你最喜欢的模型起个名字，以后它就会陪在你身边”
- 进入summon-setup

如果config里面有助理，但是有一个以上的助理模型无效
- 提示“你的助理 name1, name2 已失效了，请重新配置”
- 进入summon-setup

setup完成后，根据新的名单注册summon

当然，如果一切正常，就正常注册summon，然后就成功了，结束了

## 其它场景，比如 reload, new, ....

如果config里面没有任何的助理，说明用户是第一次使用这个版本，或是被用户自己删光了
- 提示“请给你最喜欢的模型起个名字，以后它就会陪在你身边”
- 提示“需要使用 /summon-setup 来设置你的助理”
- 不注册summon

如果config里面有助理，但是有一个以上的助理模型无效
- 提示“你的助理 name1, name2 已失效了，需要使用 /summon-setup 来配置”
- 如果剩下的助理还有正常的，就注册summon 正常的助理

当然，如果一切正常，就正常注册summon，然后就成功了，结束了

## 我描述的是否清晰？



我认为流程应该是这样的

session_start {
	load config.json
	拼装 assistantList
	load availableModels
	needSummonSetup=false
	assNumber= len (assistantList)
	deleteAssName = ""
	
	if assNumber > 0 {
		for each ass in asssistantList {
			if ass.model not in availableModels {
				deleteAssName = deletaAssName + ass.name +" "
				delete this ass from assistantList
				delete this ass from config.json
				needSummonSetup=true
			}
		}
		assNumber = len(assistantList)
	}

	if event.reason == startup {
		if assNumber > 0 {
			注册sumon assistantList
			ctx.ui.notify(把assistantList里面的助理列出来，提示注册了这些助理)
		}
		if assNumber=0 or needSummonSetup {
			ctx.ui.notify()
		}
	}else {
		
	}
}

