param([Parameter(Mandatory=$true)][string]$LegacyOutputDirectory)
$ErrorActionPreference='Stop'
$settingsRoot=(Resolve-Path -LiteralPath $LegacyOutputDirectory).Path
function Read-Section ([string]$file,[string]$section) {
 $encoding=[Text.Encoding]::GetEncoding(949)
 $map=@{};$activeSection=''
 foreach($line in [IO.File]::ReadAllLines($file,$encoding)){
  $clean=$line.Trim()
  if($clean -match '^\[([^\]]+)\]'){ $activeSection=$Matches[1]; continue }
  if($activeSection -eq $section -and $clean -match '^([^=;]+)=(.*)$'){ $map[$Matches[1].Trim()]=$Matches[2].Trim() }
 }
 return $map
}
$connection=$null
try {
 $access=Read-Section (Join-Path $settingsRoot 'Info/Db_Info.ini') 'Db_Info'
 if(@('IP','PORT','DB','ID','PW').Where({[string]::IsNullOrWhiteSpace($access[$_])}).Count -gt 0){'SOURCE_CONFIGURATION_INCOMPLETE';exit 3}
 $builder=New-Object System.Data.SqlClient.SqlConnectionStringBuilder
 $builder['Data Source']=$access['IP']+','+$access['PORT']
 $builder['Initial Catalog']=$access['DB']
 $builder['User ID']=$access['ID']
 $builder['Password']=$access['PW']
 $builder['Application Name']='POP settings reference comparison'
 $builder['ApplicationIntent']='ReadOnly'
 $builder['Connect Timeout']=5
 $builder['Pooling']=$false
 $connection=New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
 $connection.Open()
 $scope=Read-Section (Join-Path $settingsRoot 'Setting/Plant_Setting.ini') 'Plant_Setting'
 $factory=$scope['Factory_Code'];$plant=$scope['Plant_Code'];$center=$scope['WorkCenter_Code']
 if([string]::IsNullOrWhiteSpace($factory) -or [string]::IsNullOrWhiteSpace($plant) -or [string]::IsNullOrWhiteSpace($center)){throw 'SCOPE_REQUIRED'}
 function SelectRows([string]$statement,[string[]]$columns) {
  $cmd=$connection.CreateCommand();$cmd.CommandTimeout=15;$cmd.CommandText=$statement
  [void]$cmd.Parameters.Add('@factory',[Data.SqlDbType]::VarChar,6);$cmd.Parameters['@factory'].Value=$factory
  [void]$cmd.Parameters.Add('@plant',[Data.SqlDbType]::VarChar,6);$cmd.Parameters['@plant'].Value=$plant
  $reader=$cmd.ExecuteReader()
  try { while($reader.Read()){
   $result=[ordered]@{}
   foreach($col in $columns){$result[$col]=if($reader.IsDBNull($reader.GetOrdinal($col))){''}else{[string]$reader[$col]}}
   [pscustomobject]$result
  }} finally {$reader.Dispose();$cmd.Dispose()}
 }
 $processSql=@"
SELECT row_number() over(order by work_code asc) as idx,a.plant_code as plant,a.workcenter_code as center,
       a.work_code as code,a.work_name as name,a.ETC as etc
FROM tpr102 a with(nolock)
WHERE a.factory_code=@factory AND ISNULL(a.delete_flag,'0') NOT IN ('1')
ORDER BY a.factory_code,a.workcenter_code,a.work_code
"@
 $warehouseSql=@"
SELECT row_number() over(order by view_seq asc) as idx,warehouse_code as code,warehouse_name as name
FROM tco102 with(nolock)
WHERE factory_code=@factory AND plant_code=@plant AND DELETE_FLAG<>'1'
ORDER BY factory_code,plant_code,warehouse_code
"@
 $materialSql=@"
SELECT DISTINCT row_number() over(order by material_quality asc) as idx,
       a.factory_code as factory,a.material_quality as code,b.code_name_full as name
FROM tco403 a with(nolock) LEFT JOIN tco101 b with(nolock)
  ON a.factory_code=b.factory_code AND b.code_id1='424' AND a.material_quality=b.code_id2
WHERE a.factory_code=@factory AND ISNULL(a.material_quality,'')<>''
GROUP BY a.factory_code,a.material_quality,b.code_name_full
ORDER BY a.factory_code,a.material_quality
"@
 # frmLocation resolves the plant grid cell through the deployed plant/132 lookup.
 $plantLookup=@(SelectRows "SELECT a.code_name_abbr AS name FROM tco101 a WITH(NOLOCK) WHERE a.factory_code='000001' AND a.code_id1='132' AND ISNULL(a.delete_flag,'0') NOT IN ('1') AND a.code_id2=@plant ORDER BY a.factory_code,a.plant_code,a.view_seq" @('name'))
 $warehousePlantName=if($plantLookup.Count){$plantLookup[0].name}else{''}
 $processes=@(SelectRows $processSql @('idx','plant','center','code','name','etc'))
 $groupSql=$processSql.Replace("ORDER BY a.factory_code", "AND a.work_code<>'005' ORDER BY a.factory_code")
 $grouped=@(SelectRows $groupSql @('idx','plant','center','code','name','etc'))
 $warehouses=@(SelectRows $warehouseSql @('idx','code','name'))
 $materials=@(SelectRows $materialSql @('idx','code','name'))
 $savedProcess=Read-Section (Join-Path $settingsRoot 'Setting/Process_Setting.ini') 'Process_Setting'
 $savedMaterial=Read-Section (Join-Path $settingsRoot 'Setting/Material_Setting.ini') 'Material_Setting'
 $slots=[ordered]@{};for($idx=1;$idx -le 6;$idx++){$slots[[string]$idx]=[string]$savedProcess['ProcessCode'+$idx]}
 $selectedMaterial=@(for($i=1;$savedMaterial['MatQualityCode'+$i];$i++){$savedMaterial['MatQualityCode'+$i]})
 $roleNames=[ordered]@{issue='투입창고';returns='반납창고';good='양품창고';bad='불량창고';auxiliary='투입보조'}
 $roles=[ordered]@{};foreach($key in $roleNames.Keys){
  $section=$roleNames[$key];$selection=Read-Section (Join-Path $settingsRoot 'Setting/Location_Setting.ini') $section
  $roles[$key]=@(for($i=1;$selection[$section+'_코드'+$i];$i++){$selection[$section+'_코드'+$i]})
 }
 $original=[ordered]@{slots=$slots;materials=$selectedMaterial;warehouses=$roles}
 $popPath=Join-Path $settingsRoot 'Setting/PopId_Setting.ini'
 $popLocal=if([IO.File]::Exists($popPath)){Read-Section $popPath 'PopId_Setting'}else{@{}}
 $currentPop=[string]$popLocal['PopId']
 $machinePath=Join-Path $settingsRoot 'Setting/Machine_Setting.ini'
 $localMachines=if([IO.File]::Exists($machinePath)){Read-Section $machinePath 'Machine_Setting'}else{@{}}
 $machineCodes=@(1..6 | ForEach-Object { $code=$localMachines["Machine_Code$_"]; if($code){[string]$code} })
 # Only the ownership category leaves the SELECT. Hardware serial numbers stay in the database/native INI.
 function DeviceChoices([bool]$pop) {
  $cmd=$connection.CreateCommand();$cmd.CommandTimeout=15
  $filter=if($pop){"a.plant_code=@plant AND a.equip_kind='000005' AND a.equip_kind2='000010' AND a.equip_kind3='000001'"}else{"a.company_code=@plant AND a.equip_kind='000002'"}
  $ordering=if($pop){'a.equip_cd,a.equip_sys_cd'}else{'a.equip_sys_cd'}
  $cmd.CommandText="SELECT a.equip_sys_cd,a.equip_cd,a.equip_nm,CASE WHEN ISNULL(a.mainboard_serialno,'')='' THEN 'free' WHEN a.mainboard_serialno=@current THEN 'self' ELSE 'other' END FROM tpr151 a WITH(NOLOCK) WHERE a.factory_code=@factory AND $filter AND ISNULL(a.delete_flag,'')=0 ORDER BY $ordering"
  foreach($pair in @(@('factory',$factory),@('plant',$plant),@('current',$currentPop))){
   [void]$cmd.Parameters.Add(('@'+$pair[0]),[Data.SqlDbType]::NVarChar,128);$cmd.Parameters[('@'+$pair[0])].Value=$pair[1]
  }
  $reader=$cmd.ExecuteReader()
  try {while($reader.Read()){[pscustomobject]@{code=[string]$reader[0];name=[string]$reader[1];description=[string]$reader[2];ownership=[string]$reader[3]}}}
  finally{$reader.Dispose();$cmd.Dispose()}
 }
 $deviceMaster=[ordered]@{machines=@(DeviceChoices $false);popRows=@(DeviceChoices $true);selectedMachineCodes=$machineCodes;popFilePresent=[IO.File]::Exists($popPath)}
 $data=[ordered]@{kind='MES_READONLY_REFERENCE';devices=$deviceMaster;observedAt=[DateTimeOffset]::Now.ToString('o');machineSettingsFilePresent=[IO.File]::Exists((Join-Path $settingsRoot 'Setting/Machine_Setting.ini'));factory=$factory;plant=$plant;center=$center;plantName=$scope['Plant_Name'];warehousePlantName=$warehousePlantName;centerName=$scope['WorkCenter_Name'];processes=$processes;groupProcesses=$grouped;warehouses=$warehouses;materials=$materials;originalSelection=$original}
 $dir=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ShinjinPOP/local-reference'
 [void][IO.Directory]::CreateDirectory($dir)
 $file=Join-Path $dir 'terminal-settings.json'
 $tmp=Join-Path $dir ('terminal-settings.'+[Guid]::NewGuid().ToString('N')+'.tmp')
 [IO.File]::WriteAllText($tmp,($data|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
 Move-Item -LiteralPath $tmp -Destination $file -Force -ErrorAction Stop
 $nc=$processes | Group-Object code | Where-Object Count -gt 1
 $names=@($materials | Where-Object {$_.name -eq ''}).Count
 Write-Output ("observed="+$data.observedAt+" processes="+$processes.Length+" groupProcesses="+$grouped.Length+" warehouses="+$warehouses.Length+" materials="+$materials.Length+" duplicateProcessCodes="+@($nc).Length+" unnamedMaterials="+$names)
 $picked=@($slots.Values|Where-Object {$_});Write-Output ("savedProcessSlots="+$picked.Length+" inMaster="+@($picked|Where-Object {$_ -in $processes.code}).Count)
 Write-Output ("savedMaterial="+$selectedMaterial.Length+" inMaster="+@($selectedMaterial|Where-Object {$_ -in $materials.code}).Count)
 foreach($key in $roles.Keys){$items=@($roles[$key]);Write-Output ($key+" selected="+$items.Count+" inMaster="+@($items|Where-Object {$_ -in $warehouses.code}).Count)}
} catch {
 $failure=$_.Exception
 while($failure.InnerException){$failure=$failure.InnerException}
 $n=if($failure -is [System.Data.SqlClient.SqlException]){$failure.Number}else{0}
 Write-Output ("SOURCE_READ_FAILED type="+$failure.GetType().Name+" code="+$n)
 exit 2
} finally { if($connection){$connection.Dispose()} }