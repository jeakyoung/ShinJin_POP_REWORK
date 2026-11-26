package com.shinjin.pop.admin;

import com.shinjin.pop.history.PreloginSettings;
import com.shinjin.pop.history.PreloginTerminalLookup;
import com.shinjin.pop.history.WorkHistoryFixtures;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.*;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/prelogin-details/{terminalId}")
public final class PreloginPrintInfoController {
    static final Map<String,String> NONE=Map.of("document","NONE","shipment","NONE","label","NONE");
    public record LocalPrinters(Map<String,String> outputs) {}
    public record ConnectionInfo(String ftpHost,String ftpPort,String imagePath,String updatePath,String version,
                                 String dbHost,String dbPort,String database) {}
    public record Printers(long revision,List<String> devices,Map<String,String> outputs) {}
    public record PrinterEdit(Long expectedVersion,Map<String,String> outputs) {}
    public record Info(long revision,ConnectionInfo profile) {}
    public record InfoEdit(Long expectedVersion,ConnectionInfo profile) {}
    private final WorkHistoryFixtures fixtures;
    private final PreloginDetailStore store;
    private final PreloginSettings settings;
    private final ConnectionInfo initial;
    PreloginPrintInfoController(WorkHistoryFixtures fixtures,PreloginDetailStore store,PreloginSettings settings) throws java.io.IOException {
        this.fixtures=fixtures;this.store=store;this.settings=settings;
        try(var in=new ClassPathResource("demo/prelogin-connection-info.json").getInputStream()){
            initial=tools.jackson.databind.json.JsonMapper.builder().build().readValue(in,ConnectionInfo.class);
        }
    }
    private static <T> ResponseEntity<T> ok(T value){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);}
    private void scope(String terminal,HttpServletRequest req,HttpServletResponse res) {
        PreloginTerminalLookup.require(fixtures,terminal);
        settings.effective(terminal,req);
        store.browser(req,res,true);
    }
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String,String>> error(ResponseStatusException e){
        return ResponseEntity.status(e.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("code",Objects.toString(e.getReason(),"REQUEST_FAILED")));
    }
    @GetMapping("/printer")
    ResponseEntity<Printers> printers(@PathVariable String terminalId,HttpServletRequest req,HttpServletResponse res){
        scope(terminalId,req,res);
        long version=store.localVersion(terminalId,"","","printer",req);
        var outputs=store.local(terminalId,"","","printer",LocalPrinters.class,req).map(LocalPrinters::outputs).orElse(NONE);
        return ok(new Printers(version,TerminalPrinterFixture.forTerminal(terminalId),outputs));
    }
    @PutMapping(value="/printer",consumes="application/json")
    ResponseEntity<Printers> printSave(@PathVariable String terminalId,@RequestBody PrinterEdit edit,HttpServletRequest req,HttpServletResponse res){
        scope(terminalId,req,res);
        var devices=TerminalPrinterFixture.forTerminal(terminalId);
        if(edit.outputs()==null || !edit.outputs().keySet().equals(NONE.keySet()) || edit.outputs().values().stream().anyMatch(v->v==null || !devices.contains(v)))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_PRINTER");
        var selected=new LocalPrinters(Map.copyOf(edit.outputs()));
        var version=store.saveLocal(terminalId,"","","printer",edit.expectedVersion(),selected,req,res);
        return ok(new Printers(version,devices,selected.outputs()));
    }
    @GetMapping("/info")
    ResponseEntity<Info> info(@PathVariable String terminalId,HttpServletRequest req,HttpServletResponse res){
        scope(terminalId,req,res);
        var version=store.localVersion(terminalId,"","","info",req);
        var saved=store.local(terminalId,"","","info",ConnectionInfo.class,req);
        if(saved.isPresent())return ok(new Info(version,saved.get()));
        var status=settings.effective(terminalId,req);
        boolean ftp=status.ftpAddressPresent(),db=status.dbAddressPresent();
        // Local fixture values are never taken from the server's datasource, files or network configuration.
        return ok(new Info(version,new ConnectionInfo(ftp?initial.ftpHost():"",ftp?initial.ftpPort():"",
                ftp?initial.imagePath():"",ftp?initial.updatePath():"",ftp?status.version():"",db?initial.dbHost():"",
                db?initial.dbPort():"",db?initial.database():"")));
    }
    @PutMapping(value="/info",consumes="application/json")
    ResponseEntity<Info> infoSave(@PathVariable String terminalId,@RequestBody InfoEdit edit,HttpServletRequest req,HttpServletResponse res){
        scope(terminalId,req,res);
        var v=edit.profile();
        if(v==null || Arrays.asList(v.ftpHost(),v.ftpPort(),v.imagePath(),v.updatePath(),v.version(),v.dbHost(),v.dbPort(),v.database())
                .stream().anyMatch(s->s==null || s.length()>63 || s.chars().anyMatch(Character::isISOControl)))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_INFO");
        if(v.ftpHost().contains("@") || v.dbHost().contains("@"))throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"ADDRESS_HAS_CREDENTIALS");
        return ok(new Info(store.saveLocal(terminalId,"","","info",edit.expectedVersion(),v,req,res),v));
    }
}
