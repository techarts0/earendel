// Earendel Interactive Lessons Data System

export interface Lesson {
  id: number;
  title: string;
  category: '基础命令' | '文件管理' | '权限设置' | '管道重定向' | 'Shell编程';
  description: string;
  hint: string;
  commandTarget: string;
  expectedOutputRegex?: string;
  checkType: 'pwd' | 'file_exists' | 'file_content' | 'permission' | 'command_match';
  targetPath?: string;
  expectedPermission?: string;
}

export const LESSONS: Lesson[] = [
  {
    id: 1,
    title: '1. 踏入 Linux 星辰大海',
    category: '基础命令',
    description: '欢迎来到 Linux 的世界！在 Linux 中，最重要的第一步是了解你所在的位置和目录内容。请使用 `pwd` 命令查看当前工作目录路径。',
    hint: '在终端中输入 `pwd` 并回车。',
    commandTarget: 'pwd',
    checkType: 'command_match',
  },
  {
    id: 2,
    title: '2. 探索你的主目录内容',
    category: '基础命令',
    description: '知道所在目录后，看看当前目录下有哪些文件吧！请使用 `ls` 命令列出当前目录下的所有文件。',
    hint: '在终端中输入 `ls` 并回车。',
    commandTarget: 'ls',
    checkType: 'command_match',
  },
  {
    id: 3,
    title: '3. 打造你的专属工作区',
    category: '文件管理',
    description: '做项目需要建文件夹。请使用 `mkdir workspace` 命令在当前目录下创建一个名为 `workspace` 的新目录。',
    hint: '输入 `mkdir workspace`。创建后你可以在右侧文件树实时看到新建的文件夹。',
    commandTarget: 'mkdir workspace',
    checkType: 'file_exists',
    targetPath: '/home/hello/workspace',
  },
  {
    id: 4,
    title: '4. 创建第一份 Linux 文本',
    category: '文件管理',
    description: '新建一个空文件吧！请在 `workspace` 目录下使用 `touch workspace/notes.txt` 命令创建一个笔记文件。',
    hint: '输入 `touch workspace/notes.txt`。',
    commandTarget: 'touch workspace/notes.txt',
    checkType: 'file_exists',
    targetPath: '/home/hello/workspace/notes.txt',
  },
  {
    id: 5,
    title: '5. 掌握 Linux 文件权限魔方',
    category: '权限设置',
    description: 'Linux 的安全基石是文件权限 (`r`读, `w`写, `x`执行)。请使用 `chmod 755 welcome.txt` 为 `welcome.txt` 赋予所有者全部权限、其他人读与执行权限。',
    hint: '输入 `chmod 755 welcome.txt`。运行后可以在右侧文件树或 `ls -l welcome.txt` 校验权限变更。',
    commandTarget: 'chmod 755 welcome.txt',
    checkType: 'permission',
    targetPath: '/home/hello/welcome.txt',
    expectedPermission: 'rwxr-xr-x',
  },
  {
    id: 6,
    title: '6. 魔法重定向：写入文字',
    category: '管道重定向',
    description: '使用 `>` 符号可以将命令输出内容写入文件。请运行 `echo "Hello Earendel" > hello.txt` 将输出重定向写入 `hello.txt`。',
    hint: '输入 `echo "Hello Earendel" > hello.txt`。',
    commandTarget: 'echo "Hello Earendel" > hello.txt',
    checkType: 'file_exists',
    targetPath: '/home/hello/hello.txt',
  },
  {
    id: 7,
    title: '7. 体验 Shell 自动化脚本运行',
    category: 'Shell编程',
    description: '主目录下已经为你准备好了一个测试脚本 `demo.sh`！请运行 `bash demo.sh` 感受 Shell 脚本的强大魅力。',
    hint: '输入 `bash demo.sh` 或 `./demo.sh`。',
    commandTarget: 'bash demo.sh',
    checkType: 'command_match',
  },
];
