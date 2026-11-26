package com.shinjin.pop.admin;

import com.shinjin.pop.history.PreloginTerminalLookup;
import com.shinjin.pop.history.WorkHistoryFixtures;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
@Profile("demo")
public final class PreloginSiteScope {
    private final PreloginDetailStore store;
    private final WorkHistoryFixtures fixtures;
    private final EquipmentSettingsController equipment;
    private final LocalSettingsReference master;

    public PreloginSiteScope(PreloginDetailStore store, WorkHistoryFixtures fixtures, EquipmentSettingsController equipment, LocalSettingsReference master) {
        this.store=store; this.fixtures=fixtures; this.equipment=equipment; this.master=master;
    }

    public LocalSettingsReference.Site site(String terminalId,HttpServletRequest request) {
        var terminal=PreloginTerminalLookup.require(fixtures,terminalId);
        return store.local(terminalId,"","","plant",LocalSettingsReference.Site.class,request)
                .or(()->equipment.configuredSite(terminal.factory(),terminalId)).or(()->master.siteFor(terminalId)).orElseGet(()->{
                    var plant=EquipmentSettingsFixture.PLANTS.get(terminalId);
                    if(plant==null) throw new ResponseStatusException(HttpStatus.CONFLICT,"PLANT_REQUIRED");
                    var station=fixtures.station(terminalId);
                    return new LocalSettingsReference.Site(terminal.factory(),plant,station==null?"DEMO-WC-"+terminalId:station.center(),plant,terminal.workCenter());
                });
    }
}
