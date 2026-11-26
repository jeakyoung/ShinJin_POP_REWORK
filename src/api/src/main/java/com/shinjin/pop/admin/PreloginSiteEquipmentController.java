package com.shinjin.pop.admin;

import com.shinjin.pop.history.PreloginSettings;
import com.shinjin.pop.history.PreloginTerminalLookup;
import com.shinjin.pop.history.WorkHistoryFixtures;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/prelogin-site-equipment/{terminal}/{kind}")
final class PreloginSiteEquipmentController {
    record Save(Long expectedVersion, Long equipmentVersion, String plant, String center,
                String scopePlant,String scopeCenter,Long siteRevision, List<String> machines, String number) {}

    private final EquipmentSettingsController equipment;
    private final PreloginDetailStore store;
    private final PreloginSettings flags;
    private final WorkHistoryFixtures fixtures;

    PreloginSiteEquipmentController(EquipmentSettingsController equipment, PreloginDetailStore store,
                                   PreloginSettings flags, WorkHistoryFixtures fixtures) {
        this.equipment=equipment;this.store=store;this.flags=flags;this.fixtures=fixtures;
    }
    private EquipmentSettingsController.View view(String terminal,String kind,HttpServletRequest request) {
        if (!Set.of("plant","machine","popId").contains(kind)) throw problem(HttpStatus.NOT_FOUND,"SETTING_UNKNOWN");
        var status=flags.effective(terminal,request);
        if (!kind.equals("plant")) {
            if (status.missing().contains("plant")) throw problem(HttpStatus.CONFLICT,"PLANT_REQUIRED");
            if (status.missing().contains("process")) throw problem(HttpStatus.CONFLICT,"PROCESS_REQUIRED");
        }
        return equipment.anonymousView(terminal,kind,status.missing().contains("plant"),request);
    }
    @GetMapping
    ResponseEntity<?> settings(@PathVariable String terminal,@PathVariable String kind,HttpServletRequest request) {
        var view=view(terminal,kind,request);
        return ok(Map.of("view",Map.of("saved",Map.of("version",view.version(),"values",
                Map.of("process",!flags.effective(terminal,request).missing().contains("process"))))));
    }
    @GetMapping("/equipment")
    ResponseEntity<?> equipment(@PathVariable String terminal,@PathVariable String kind,HttpServletRequest request) {
        return ok(view(terminal,kind,request));
    }
    @PutMapping("/plant")
    ResponseEntity<?> site(@PathVariable String terminal,@PathVariable String kind,@RequestBody Save body,
                           HttpServletRequest req,HttpServletResponse res) {
        if (!kind.equals("plant")) throw problem(HttpStatus.NOT_FOUND,"SETTING_UNKNOWN");
        synchronized (equipment) {
            var v=view(terminal,kind,req);
            if (!Objects.equals(body.equipmentVersion(),v.version())) throw problem(HttpStatus.CONFLICT,"STALE_SETTINGS");
            var source=v.sites().stream().filter(s->s.plant().equals(body.plant())&&s.center().equals(body.center()))
                    .findFirst().orElseThrow(()->problem(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_SITE"));
            var factory=PreloginTerminalLookup.require(fixtures,terminal).factory();
            var site=new LocalSettingsReference.Site(factory,source.plant(),source.center(),source.plantName(),source.centerName());
            store.saveLocal(terminal,"","","plant",body.expectedVersion(),site,req,res);
            return ok(Map.of("saved",true));
        }
    }
    @PutMapping("/equipment/{operation}")
    ResponseEntity<?> assignment(@PathVariable String terminal,@PathVariable String kind,@PathVariable String operation,
                                 @RequestBody Save body,HttpServletRequest req,HttpServletResponse res) {
        if (!(kind.equals("machine")&&operation.equals("machines") || kind.equals("popId")&&operation.equals("pop-id")))
            throw problem(HttpStatus.NOT_FOUND,"SETTING_UNKNOWN");
        synchronized (equipment) {
            var v=view(terminal,kind,req);
            if (!Objects.equals(body.siteRevision(),v.siteRevision()) || !v.site().plant().equals(body.scopePlant())
                    || !v.site().center().equals(body.scopeCenter()) || !Objects.equals(body.expectedVersion(),v.version()))
                return ResponseEntity.status(409).cacheControl(CacheControl.noStore()).body(v);
            Object value;
            long now=Instant.now().toEpochMilli();
            if (kind.equals("machine")) {
                var requested=body.machines();
                if (requested==null || requested.isEmpty() || requested.size()>6 ||
                        requested.contains(EquipmentSettingsFixture.NONE) && requested.size()!=1) throw invalid();
                var ordered=v.machines().stream().map(EquipmentSettingsController.MachineRow::code).filter(requested::contains).toList();
                if (ordered.size()!=requested.size()) throw invalid();
                value=new EquipmentSettingsController.MachineSelection(ordered,now);
            } else {
                if (v.popRows().stream().noneMatch(row->row.code().equals(body.number()))) throw invalid();
                value=new EquipmentSettingsController.PopSelection(body.number(),now);
            }
            try {
                store.saveLocal(terminal,v.site().plant(),v.site().center(),kind,body.expectedVersion(),value,req,res,body.siteRevision());
            } catch (ResponseStatusException e) {
                if (e.getStatusCode().value()!=409 && e.getStatusCode().value()!=412) throw e;
                return ResponseEntity.status(409).cacheControl(CacheControl.noStore()).body(view(terminal,kind,req));
            }
            return ok(view(terminal,kind,req));
        }
    }
    private static ResponseEntity<?> ok(Object body) {return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);}
    private static ResponseStatusException invalid() {return problem(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_EQUIPMENT_SETTINGS");}
    private static ResponseStatusException problem(HttpStatus status,String code) {return new ResponseStatusException(status,code);}
}
