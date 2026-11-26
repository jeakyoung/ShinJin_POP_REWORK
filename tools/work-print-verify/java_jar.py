"""Exercise work-print on an isolated local Spring demo JAR; no native report runtime."""
import copy
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile


def inspect_jar(jar):
    with zipfile.ZipFile(jar) as archive:
        names = archive.namelist()
        libraries = [name for name in names if name.startswith('BOOT-INF/lib/') and name.endswith('.jar')]
        for name in libraries:
            if re.search('jdbc|hikari|sqlserver|h2-', name, re.I):
                raise ValueError('Use the isolated demo JAR without database libraries')
            with zipfile.ZipFile(io.BytesIO(archive.read(name))) as nested:
                if any(entry.lower().endswith(('.exe', '.dll')) for entry in nested.namelist()):
                    raise ValueError(name)
        if any(name.lower().endswith(('.exe', '.dll')) for name in names):
            raise ValueError('Native executable in JAR')
        for name in names:
            if '/com/shinjin/pop/workprint/' in name and name.endswith('.class'):
                bytecode = archive.read(name)
                if any(token in bytecode for token in (b'ProcessBuilder', b'java/lang/Runtime', b'loadLibrary', b'DevExpress')):
                    raise ValueError(name)
        return json.loads(archive.read('BOOT-INF/classes/demo/work-print.json'))


def stress_file(fixture, scratch):
    data = copy.deepcopy(fixture)
    template = data['orders'][0]
    data['orders'] = []
    for i in range(1, 29):
        row = copy.deepcopy(template)
        row['key'] = 'ROW-' + str(i)
        row['grid']['ORDER_SEQNO'] = str(i)
        row['report'].update(No=str(i), ProdPlanBarCode='20261126'+str(i), FG_USE2='002' if i==2 else '001')
        data['orders'].append(row)
    path = scratch/'stress.json'
    path.write_text(json.dumps(data), encoding='utf8')
    return path


def run(mode, source, evidence, font, latin, fixture):
    with tempfile.TemporaryDirectory(prefix='work-print-jar-') as tmp:
        scratch = Path(tmp)
        jar = scratch/'demo.jar'
        shutil.copyfile(source, jar)
        configured = scratch/'font.ttf' if mode=='recover' else font
        java = shutil.which('java')
        if not java:
            raise RuntimeError('JDK 17 java must be on PATH')
        args = [java,'-Xmx520m','-Djava.awt.headless=true','-jar',str(jar),
                '--spring.config.location=optional:classpath:/isolated.properties',
                '--spring.profiles.active=demo','--server.address=127.0.0.1','--server.port=0',
                '--shinjin.demo.work-print-font='+str(configured),
                '--shinjin.demo.work-print-submit='+str(mode!='off').lower()]
        if mode=='stress':
            args.append('--shinjin.demo.work-print-data='+stress_file(fixture,scratch).as_uri())
        logfile = evidence/(mode+'-boot.log')
        with logfile.open('wb') as log:
            proc = subprocess.Popen(args,cwd=scratch,env=dict(os.environ,PATH=tmp),stdout=log,stderr=log)
            try:
                for _ in range(800):
                    output = logfile.read_text(encoding='utf8',errors='replace')
                    port = re.search(r'Tomcat started on port (\d+)',output)
                    if port:
                        break
                    if proc.poll() is not None:
                        raise RuntimeError(output[-3000:])
                    time.sleep(.1)
                else:
                    raise RuntimeError('Loopback Spring startup timed out')
                check = Path(__file__).with_name('http_check.py')
                result = subprocess.run([sys.executable,check,port[1],mode,evidence,configured,font,latin],
                                        stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
                (evidence/(mode+'-result.txt')).write_bytes(result.stdout)
                result.check_returncode()
            finally:
                proc.terminate()
                proc.wait(timeout=15)


if __name__=='__main__':
    jar, evidence, font, latin = [Path(value).resolve() for value in sys.argv[1:5]]
    evidence.mkdir(parents=True,exist_ok=True)
    fixture = inspect_jar(jar)
    for mode in ('http','counts','recover','off','stress'):
        run(mode,jar,evidence,font,latin,fixture)
        print(mode,'PASS',flush=True)
